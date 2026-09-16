/**
 * Delivery layer: turns a stored notification into push / email / SMS deliveries,
 * honoring per-category preferences, quiet hours, and daily digests.
 * When a real transport is not configured, deliveries are recorded as "simulated"
 * and shown in the in-app Outbox so the prototype is fully inspectable.
 */
import webpush from 'web-push';
import nodemailer, { type Transporter } from 'nodemailer';
import { q, kv, now } from '../db.js';
import { config } from '../config.js';
import { CATEGORY_LABEL, type Channel, type Category } from './categories.js';
import { renderEmailHtml } from './emailHtml.js';
import { getSettings, getUser, freqFor, isQuietNow, quietHoursEnd, localParts, type UserRow, type Settings } from '../users.js';

export interface NotificationRow {
  id: number; user_id: number; category: Category; title: string; body: string;
  course_id: string | null; course_name: string | null; url: string | null; meta_json: string;
  dedupe_key: string; is_read: number; created_at: number;
}

// ---------- VAPID (web push) ----------
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  let pub = await kv.get('vapid_public'), priv = await kv.get('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    await kv.set('vapid_public', pub); await kv.set('vapid_private', priv);
  }
  return { publicKey: pub, privateKey: priv };
}
{
  const k = await vapidKeys();
  webpush.setVapidDetails('mailto:dispatch@example.com', k.publicKey, k.privateKey);
}

// ---------- creating notifications ----------
export interface NotificationInput {
  category: Category; title: string; body?: string; course_id?: string | null; course_name?: string | null;
  url?: string | null; meta?: Record<string, unknown>; dedupe_key: string; created_at?: number;
  /** When true the notification is stored but not pushed out (used for historical seeding). */
  silent?: boolean;
}

export async function createNotification(user: UserRow, input: NotificationInput): Promise<NotificationRow | undefined> {
  const exists = await q.get('SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?', user.id, input.dedupe_key);
  if (exists) return undefined;
  const r = await q.run(`INSERT INTO notifications (user_id, category, title, body, course_id, course_name, url, meta_json, dedupe_key, is_read, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    user.id, input.category, input.title, input.body ?? '', input.course_id ?? null, input.course_name ?? null,
    input.url ?? null, JSON.stringify(input.meta ?? {}), input.dedupe_key, input.created_at ?? now());
  const notif = (await q.get<NotificationRow>('SELECT * FROM notifications WHERE id = ?', Number(r.lastInsertRowid)))!;
  if (!input.silent) void enqueueDeliveries(user, notif);
  return notif;
}

// ---------- queuing ----------
async function addresses(user: UserRow, channel: Channel): Promise<string[]> {
  if (channel === 'push') return (await q.all<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', user.id)).map(r => r.endpoint);
  const rows = await q.all<{ address: string }>('SELECT address FROM channels WHERE user_id = ? AND type = ? AND verified = 1', user.id, channel);
  return rows.map(r => r.address);
}

export async function enqueueDeliveries(user: UserRow, notif: NotificationRow) {
  const settings = getSettings(user);
  for (const channel of ['push', 'email', 'sms'] as Channel[]) {
    const freq = freqFor(settings, notif.category, channel);
    if (freq === 'never') continue;
    const addrs = await addresses(user, channel);
    if (!addrs.length) continue;
    const { subject, body } = render(channel, notif);
    for (const address of addrs) {
      if (freq === 'daily') {
        await q.run(`INSERT INTO deliveries (user_id, notification_id, channel, address, status, subject, body, created_at) VALUES (?,?,?,?,'digest',?,?,?)`,
          user.id, notif.id, channel, address, subject, body, now());
        continue;
      }
      const sendAfter = isQuietNow(settings) ? quietHoursEnd(settings) : null;
      const r = await q.run(`INSERT INTO deliveries (user_id, notification_id, channel, address, status, subject, body, send_after, created_at) VALUES (?,?,?,?,'queued',?,?,?,?)`,
        user.id, notif.id, channel, address, subject, body, sendAfter, now());
      if (!sendAfter) await sendDelivery(Number(r.lastInsertRowid));
    }
  }
}

// ---------- rendering ----------
function render(channel: Channel, n: NotificationRow): { subject: string; body: string } {
  const course = n.course_name ? `[${n.course_name}] ` : '';
  const label = CATEGORY_LABEL[n.category] ?? n.category;
  if (channel === 'sms') {
    const text = `Dispatch · ${label}\n${course}${n.title}${n.body ? `\n${stripHtml(n.body).slice(0, 160)}` : ''}${n.url ? `\n${n.url}` : ''}`;
    return { subject: label, body: text.slice(0, 480) };
  }
  if (channel === 'push') {
    return { subject: `${course}${n.title}`, body: stripHtml(n.body).slice(0, 180) };
  }
  return {
    subject: `${course}${n.title}`,
    body: `${label}\n\n${n.title}\n${stripHtml(n.body)}\n\n${n.url ? `Open in Canvas: ${n.url}\n\n` : ''}— Dispatch for Canvas`,
  };
}
export const stripHtml = (s: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// ---------- sending ----------
interface DeliveryRow { id: number; user_id: number; notification_id: number | null; channel: Channel; address: string; status: string; subject: string; body: string; }

export async function sendDelivery(id: number) {
  const d = await q.get<DeliveryRow>('SELECT * FROM deliveries WHERE id = ?', id);
  if (!d || (d.status !== 'queued' && d.status !== 'digest')) return;
  const notif = d.notification_id ? await q.get<NotificationRow>('SELECT * FROM notifications WHERE id = ?', d.notification_id) : undefined;
  try {
    let status: 'sent' | 'simulated' = 'simulated';
    if (d.channel === 'push') status = await sendPush(d, notif);
    else if (d.channel === 'email') status = await sendEmail(d, notif);
    else if (d.channel === 'sms') status = await sendSms(d);
    await q.run('UPDATE deliveries SET status = ?, sent_at = ?, error = NULL WHERE id = ?', status, now(), id);
  } catch (e: any) {
    await q.run('UPDATE deliveries SET status = ?, error = ? WHERE id = ?', 'failed', String(e?.message ?? e).slice(0, 300), id);
  }
}

async function sendPush(d: DeliveryRow, notif?: NotificationRow): Promise<'sent' | 'simulated'> {
  const sub = await q.get<{ subscription_json: string }>('SELECT subscription_json FROM push_subscriptions WHERE endpoint = ?', d.address);
  if (!sub) throw new Error('push subscription no longer exists');
  const payload = JSON.stringify({ title: d.subject, body: d.body, url: notif?.url ?? config.appUrl, tag: notif ? `n-${notif.id}` : `d-${d.id}`, category: notif?.category });
  try {
    await webpush.sendNotification(JSON.parse(sub.subscription_json), payload, { TTL: 3600 });
    return 'sent';
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await q.run('DELETE FROM push_subscriptions WHERE endpoint = ?', d.address);
    throw e;
  }
}

/** Splits "Name <addr@example.com>" (or a bare address) into its parts. */
function parseFrom(raw: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<(.+)>\s*$/.exec(raw);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: raw.trim() };
}

let transporter: Transporter | null = null;
async function sendEmail(d: DeliveryRow, notif?: NotificationRow): Promise<'sent' | 'simulated'> {
  const html = renderEmailHtml({
    eyebrow: notif ? (CATEGORY_LABEL[notif.category] ?? notif.category) : undefined,
    title: notif?.title ?? d.subject,
    body: notif ? stripHtml(notif.body) : d.body,
    ctaUrl: notif?.url || config.appUrl,
    ctaLabel: notif?.url ? 'Open in Canvas' : 'Open Dispatch',
  });
  // Prefer Brevo's HTTP API: it works on hosts that block outbound SMTP ports
  // (e.g. Render's free tier). Nodemailer/SMTP stays as a fallback for hosts that don't.
  if (config.brevo.enabled) {
    const sender = parseFrom(config.brevo.from);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.brevo.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender.email, name: sender.name },
        to: [{ email: d.address }],
        subject: d.subject,
        textContent: d.body,
        htmlContent: html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return 'sent';
  }
  if (!config.smtp.enabled) return 'simulated';
  transporter ??= nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined });
  await transporter.sendMail({ from: config.smtp.from, to: d.address, subject: d.subject, text: d.body, html });
  return 'sent';
}

async function sendSms(d: DeliveryRow): Promise<'sent' | 'simulated'> {
  if (!config.twilio.enabled) return 'simulated';
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: config.twilio.from, To: d.address, Body: d.body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return 'sent';
}

// ---------- background processing ----------
/** Sends deliveries whose quiet-hours hold has expired. */
export async function processQueue() {
  const due = await q.all<{ id: number }>('SELECT id FROM deliveries WHERE status = ? AND (send_after IS NULL OR send_after <= ?)', 'queued', now());
  for (const r of due) await sendDelivery(r.id);
}

/** Builds and sends one digest per channel at the user's chosen local time. */
export async function processDigests() {
  for (const user of await q.all<UserRow>('SELECT * FROM users')) {
    const settings = getSettings(user);
    const { hh, mm, ymd } = localParts(now(), settings.timezone);
    const [dh, dm] = settings.digestTime.split(':').map(Number);
    if (hh * 60 + mm < dh * 60 + dm) continue;
    for (const channel of ['push', 'email', 'sms'] as Channel[]) {
      const k = `digest:${user.id}:${channel}:${ymd}`;
      if (await kv.get(k)) continue;
      await kv.set(k, '1');
      await sendDigest(user, settings, channel, ymd);
    }
  }
}

export async function sendDigest(user: UserRow, settings: Settings, channel: Channel, ymd: string, force = false) {
  const pending = await q.all<DeliveryRow & { category: string; title: string; course_name: string | null }>(
    `SELECT d.*, n.category, n.title, n.course_name FROM deliveries d LEFT JOIN notifications n ON n.id = d.notification_id
     WHERE d.user_id = ? AND d.channel = ? AND d.status = 'digest' ORDER BY d.created_at`, user.id, channel);
  const wantsDigest = freqFor(settings, 'digest', channel) !== 'never';
  if (!pending.length && !wantsDigest && !force) return;
  const addrs = await addresses(user, channel);
  if (!addrs.length) return;

  const upcoming = (await q.all<{ data_json: string }>(`SELECT data_json FROM snapshot WHERE user_id = ? AND kind = 'assignment'`, user.id))
    .map(r => JSON.parse(r.data_json))
    .filter(a => a.due_at && a.submission?.workflow_state === 'unsubmitted' && !a.submission?.excused)
    .map(a => ({ ...a, dueMs: new Date(a.due_at).getTime() }))
    .filter(a => a.dueMs > now() && a.dueMs < now() + 48 * 3_600_000)
    .sort((a, b) => a.dueMs - b.dueMs);
  const courseName = async (id: string) => (await q.get<{ name: string }>('SELECT name FROM courses WHERE user_id = ? AND canvas_id = ?', user.id, id))?.name ?? '';

  const lines: string[] = [];
  lines.push(`Your Dispatch digest for ${ymd}`);
  lines.push('');
  lines.push(upcoming.length ? `DUE IN THE NEXT 48 HOURS (${upcoming.length})` : 'Nothing due in the next 48 hours.');
  for (const a of upcoming) lines.push(`  • ${a.name} — ${await courseName(a.course_id)} — due ${new Date(a.dueMs).toLocaleString('en-US', { timeZone: settings.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
  if (pending.length) {
    lines.push('');
    lines.push(`SINCE YOUR LAST DIGEST (${pending.length})`);
    const groups = new Map<string, typeof pending>();
    for (const p of pending) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    for (const [cat, items] of groups) {
      lines.push(`  ${CATEGORY_LABEL[cat as Category] ?? cat}`);
      for (const it of items) lines.push(`    • ${it.course_name ? `[${it.course_name}] ` : ''}${it.title}`);
    }
  }
  lines.push('');
  lines.push(`Open Dispatch: ${config.appUrl}`);
  const subject = `Dispatch digest: ${upcoming.length} due soon, ${pending.length} update${pending.length === 1 ? '' : 's'}`;
  const body = channel === 'sms' ? lines.join('\n').slice(0, 600) : lines.join('\n');

  const digestNotif = await createNotification(user, {
    category: 'digest', title: subject, body: lines.slice(2).join('\n'), dedupe_key: `digest:${channel}:${ymd}:${force ? now() : ''}`, silent: true,
  });
  for (const address of addrs) {
    const r = await q.run(`INSERT INTO deliveries (user_id, notification_id, channel, address, status, subject, body, created_at) VALUES (?,?,?,?,'queued',?,?,?)`,
      user.id, digestNotif?.id ?? null, channel, address, subject, body, now());
    await sendDelivery(Number(r.lastInsertRowid));
  }
  if (pending.length) await q.run(`UPDATE deliveries SET status = 'digested', sent_at = ? WHERE id IN (${pending.map(p => p.id).join(',')})`, now());
}

export async function userById(id: number) { return getUser(id); }
