import { Router, type Request, type Response, type NextFunction } from 'express';
import { q, now } from '../db.js';
import { config } from '../config.js';
import { CATEGORIES } from '../notify/categories.js';
import { vapidKeys, sendDigest, type NotificationRow } from '../notify/deliver.js';
import { getSettings, saveSettings, readSession, type UserRow, type Settings } from '../users.js';
import { syncUser, evaluateTimeRules, isSyncing, getSource } from '../sync/engine.js';
import { simulateActivity, loadWorld } from '../canvas/mock.js';
import { SESSION_COOKIE } from './auth.js';
import type { CanvasAssignment } from '../canvas/types.js';

export const api = Router();

declare global { namespace Express { interface Request { user: UserRow } } }

api.use(async (req: Request, res: Response, next: NextFunction) => {
  const user = await readSession(req.cookies?.[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
});

const publicUser = (u: UserRow) => ({
  id: u.id, name: u.name, avatar_url: u.avatar_url, email: u.primary_email, auth_mode: u.auth_mode,
  canvas_base_url: u.canvas_base_url, last_sync_at: u.last_sync_at, last_sync_error: u.last_sync_error,
});

api.get('/me', async (req, res) => {
  const unread = (await q.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id))!.n;
  res.json({ user: publicUser(req.user), settings: getSettings(req.user), unread, categories: CATEGORIES, syncing: isSyncing(req.user.id),
    courseCount: (await q.get<{ n: number }>('SELECT COUNT(*) n FROM courses WHERE user_id = ?', req.user.id))!.n,
    capabilities: { oauth: config.canvasOAuth.enabled, smtp: config.sendgrid.enabled || config.smtp.enabled, sms: config.twilio.enabled, syncIntervalMinutes: config.syncIntervalMs / 60000 } });
});

// ---------- notifications ----------
api.get('/notifications', async (req, res) => {
  const { category, course, unread, limit = '200' } = req.query as Record<string, string>;
  const where: string[] = ['user_id = ?']; const params: any[] = [req.user.id];
  if (category) { where.push('category = ?'); params.push(category); }
  if (course) { where.push('course_id = ?'); params.push(course); }
  if (unread === '1') where.push('is_read = 0');
  const rows = await q.all<NotificationRow>(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...params, Math.min(Number(limit) || 200, 500));
  res.json(rows.map(r => ({ ...r, meta: JSON.parse(r.meta_json), is_read: Boolean(r.is_read) })));
});
api.post('/notifications/read', async (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (req.body?.all) await q.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  else if (ids.length) await q.run(`UPDATE notifications SET is_read = ? WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, req.body?.read === false ? 0 : 1, req.user.id, ...ids);
  res.json({ ok: true });
});
api.delete('/notifications/:id', async (req, res) => {
  await q.run('DELETE FROM notifications WHERE user_id = ? AND id = ?', req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- courses ----------
api.get('/courses', async (req, res) => {
  res.json((await q.all('SELECT * FROM courses WHERE user_id = ? ORDER BY name', req.user.id)).map(c => ({ ...c, muted: Boolean(c.muted) })));
});
api.patch('/courses/:id', async (req, res) => {
  if (typeof req.body?.muted === 'boolean') await q.run('UPDATE courses SET muted = ? WHERE user_id = ? AND canvas_id = ?', req.body.muted ? 1 : 0, req.user.id, req.params.id);
  res.json({ ok: true });
});

// ---------- upcoming (assignments from the snapshot) ----------
api.get('/upcoming', async (req, res) => {
  const courses = new Map((await q.all<{ canvas_id: string; name: string; course_code: string; muted: number }>('SELECT canvas_id, name, course_code, muted FROM courses WHERE user_id = ?', req.user.id)).map(c => [c.canvas_id, c]));
  const rows = await q.all<{ key: string; data_json: string }>(`SELECT key, data_json FROM snapshot WHERE user_id = ? AND kind = 'assignment'`, req.user.id);
  const reminders = await q.all<{ id: number; assignment_key: string | null; remind_at: number; fired: number; title: string; note: string | null }>('SELECT * FROM reminders WHERE user_id = ?', req.user.id);
  const t = now();
  const items = rows.map(r => {
    const a = JSON.parse(r.data_json) as CanvasAssignment;
    const c = courses.get(a.course_id);
    const due = a.due_at ? new Date(a.due_at).getTime() : null;
    const s = a.submission;
    const status = s.excused ? 'excused' : s.score != null ? 'graded' : s.submitted_at ? 'submitted' : due && due < t ? 'missing' : 'todo';
    return { key: r.key, id: a.id, course_id: a.course_id, course_name: c?.name ?? '', course_code: c?.course_code ?? '', name: a.name, due_at: a.due_at, due_ms: due, points_possible: a.points_possible, html_url: a.html_url, status, score: s.score, grade: s.grade, submission_types: a.submission_types, reminders: reminders.filter(x => x.assignment_key === r.key) };
  });
  const upcoming = items.filter(i => i.due_ms && i.due_ms >= t - 14 * 86400000).sort((a, b) => a.due_ms! - b.due_ms!);
  const undated = items.filter(i => !i.due_ms && i.status === 'todo');
  res.json({ upcoming, undated, freeReminders: reminders.filter(r => !r.assignment_key).sort((a, b) => a.remind_at - b.remind_at) });
});

// ---------- reminders ----------
api.post('/reminders', async (req, res) => {
  const { assignment_key = null, title, note = null, remind_at } = req.body ?? {};
  const at = Number(remind_at);
  if (!title || !at) return res.status(400).json({ error: 'title and remind_at are required' });
  const r = await q.run('INSERT INTO reminders (user_id, assignment_key, title, note, remind_at, created_at) VALUES (?,?,?,?,?,?)', req.user.id, assignment_key, String(title).slice(0, 200), note ? String(note).slice(0, 500) : null, at, now());
  await evaluateTimeRules(req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.delete('/reminders/:id', async (req, res) => {
  await q.run('DELETE FROM reminders WHERE user_id = ? AND id = ?', req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- settings ----------
api.put('/settings', async (req, res) => {
  const cur = getSettings(req.user);
  const b = req.body ?? {};
  const next: Settings = {
    timezone: typeof b.timezone === 'string' ? b.timezone : cur.timezone,
    prefs: typeof b.prefs === 'object' && b.prefs ? b.prefs : cur.prefs,
    dueWindows: Array.isArray(b.dueWindows) ? b.dueWindows.map(Number).filter((n: number) => n > 0 && n <= 20160).slice(0, 6) : cur.dueWindows,
    digestTime: /^\d{2}:\d{2}$/.test(b.digestTime ?? '') ? b.digestTime : cur.digestTime,
    quietHours: { ...cur.quietHours, ...(b.quietHours ?? {}) },
    missingAlerts: typeof b.missingAlerts === 'boolean' ? b.missingAlerts : cur.missingAlerts,
  };
  await saveSettings(req.user.id, next);
  res.json(next);
});

// ---------- channels ----------
api.get('/channels', async (req, res) => {
  res.json({
    channels: await q.all('SELECT id, type, address, verified, created_at FROM channels WHERE user_id = ? ORDER BY created_at', req.user.id),
    push: (await q.all('SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?', req.user.id)).map((p: any) => ({ ...p, endpoint: p.endpoint.slice(0, 40) + '…' })),
  });
});
api.post('/channels', async (req, res) => {
  const type = req.body?.type, address = String(req.body?.address ?? '').trim();
  if (type !== 'email' && type !== 'sms') return res.status(400).json({ error: 'type must be email or sms' });
  if (type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (type === 'sms' && !/^\+?[\d\s().-]{7,20}$/.test(address)) return res.status(400).json({ error: 'Enter a valid phone number, e.g. +1 555 123 4567' });
  const clean = type === 'sms' ? address.replace(/[^\d+]/g, '') : address.toLowerCase();
  await q.run('INSERT INTO channels (user_id, type, address, verified, created_at) VALUES (?,?,?,1,?) ON CONFLICT (user_id, type, address) DO NOTHING', req.user.id, type, clean, now());
  res.json({ ok: true });
});
api.delete('/channels/:id', async (req, res) => {
  await q.run('DELETE FROM channels WHERE user_id = ? AND id = ?', req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- web push ----------
api.get('/push/vapid', async (_req, res) => res.json({ publicKey: (await vapidKeys()).publicKey }));
api.post('/push/subscribe', async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'subscription required' });
  await q.run('INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription_json = excluded.subscription_json',
    req.user.id, sub.endpoint, JSON.stringify(sub), now());
  res.json({ ok: true });
});
api.post('/push/unsubscribe', async (req, res) => {
  if (req.body?.endpoint) await q.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, req.body.endpoint);
  res.json({ ok: true });
});

// ---------- outbox / deliveries ----------
api.get('/deliveries', async (req, res) => {
  const rows = await q.all(`SELECT d.*, n.category, n.url FROM deliveries d LEFT JOIN notifications n ON n.id = d.notification_id WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT 200`, req.user.id);
  res.json(rows);
});
api.post('/deliveries/digest-now', async (req, res) => {
  const settings = getSettings(req.user);
  const channel = ['push', 'email', 'sms'].includes(req.body?.channel) ? req.body.channel : 'email';
  const ymd = new Date().toISOString().slice(0, 10);
  await sendDigest(req.user, settings, channel, ymd, true);
  res.json({ ok: true });
});

// ---------- stats ----------
api.get('/stats', async (req, res) => {
  const t = now();
  const unread = (await q.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id))!.n;
  const gradesWeek = (await q.get<{ n: number }>(`SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category IN ('grade_posted','grade_changed') AND created_at > ?`, req.user.id, t - 7 * 86400000))!.n;
  const rows = (await q.all<{ data_json: string }>(`SELECT data_json FROM snapshot WHERE user_id = ? AND kind = 'assignment'`, req.user.id)).map(r => JSON.parse(r.data_json) as CanvasAssignment);
  const outstanding = rows.filter(a => a.submission.workflow_state === 'unsubmitted' && !a.submission.excused && a.submission.score == null && a.due_at);
  const dueWeek = outstanding.filter(a => { const d = new Date(a.due_at!).getTime(); return d > t && d < t + 7 * 86400000; }).length;
  const missing = outstanding.filter(a => new Date(a.due_at!).getTime() < t && t - new Date(a.due_at!).getTime() < 14 * 86400000).length;
  const inbox = (await q.get<{ n: number }>(`SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category = 'conversation_message' AND is_read = 0`, req.user.id))!.n;
  res.json({ unread, gradesWeek, dueWeek, missing, inbox });
});

// ---------- sync + demo controls ----------
api.post('/sync', async (req, res) => {
  const r = await syncUser(req.user.id);
  const fresh = (await readSession(req.cookies?.[SESSION_COOKIE]))!;
  if (fresh.last_sync_error) return res.status(502).json({ error: fresh.last_sync_error, ...r });
  res.json({ ok: true, ...r, user: publicUser(fresh) });
});

/** Live connection test: talks to Canvas right now and reports exactly what it sees. */
api.get('/diagnostics', async (req, res) => {
  const t0 = now();
  const steps: { step: string; ok: boolean; detail: string }[] = [];
  try {
    const source = await getSource(req.user);
    const profile = await source.profile();
    steps.push({ step: 'Authenticate', ok: true, detail: `Signed in as ${profile.name}${profile.primary_email ? ` (${profile.primary_email})` : ''}` });
    const courses = await source.courses();
    steps.push({ step: 'List active courses', ok: courses.length > 0, detail: courses.length ? courses.map(c => c.course_code || c.name).join(', ') : 'Canvas returned no active courses for this account. Check that your enrollments are current-term and published.' });
    if (courses.length) {
      const a = await source.assignments(courses[0].id);
      steps.push({ step: `Read assignments (${courses[0].course_code || courses[0].name})`, ok: true, detail: `${a.length} assignment(s), ${a.filter(x => x.submission.score != null).length} graded` });
    }
    res.json({ ok: steps.every(s => s.ok), ms: now() - t0, steps, base_url: req.user.canvas_base_url, auth_mode: req.user.auth_mode });
  } catch (e: any) {
    steps.push({ step: steps.length === 0 ? 'Authenticate' : 'Read course data', ok: false, detail: String(e?.message ?? e) });
    res.json({ ok: false, ms: now() - t0, steps, base_url: req.user.canvas_base_url, auth_mode: req.user.auth_mode });
  }
});
api.post('/demo/simulate', async (req, res) => {
  if (req.user.auth_mode !== 'demo') return res.status(400).json({ error: 'Only available in demo mode' });
  const msg = await simulateActivity(`u${req.user.id}`, req.body?.kind);
  const r = await syncUser(req.user.id);
  res.json({ ok: true, message: msg, ...r });
});
api.get('/demo/log', async (req, res) => {
  if (req.user.auth_mode !== 'demo') return res.json([]);
  res.json((await loadWorld(`u${req.user.id}`)).log);
});
