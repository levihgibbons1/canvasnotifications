import { randomBytes, createHmac } from 'node:crypto';
import { q, now } from './db.js';
import { config } from './config.js';
import { CATEGORIES, type Category, type Channel, type Frequency } from './notify/categories.js';

export interface UserRow {
  id: number;
  auth_mode: 'demo' | 'token' | 'oauth';
  canvas_base_url: string;
  canvas_user_id: string;
  name: string;
  avatar_url: string | null;
  primary_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  settings_json: string;
  created_at: number;
  last_sync_at: number | null;
  last_sync_error: string | null;
}

export interface Settings {
  timezone: string;
  /** category -> channel -> frequency */
  prefs: Record<string, Partial<Record<Channel, Frequency>>>;
  /** minutes before a due date to send reminders, e.g. [1440, 180, 60] */
  dueWindows: number[];
  /** "HH:MM" local time for daily digests */
  digestTime: string;
  quietHours: { enabled: boolean; start: string; end: string };
  missingAlerts: boolean;
}

export function defaultSettings(timezone = 'UTC'): Settings {
  const prefs: Settings['prefs'] = {};
  for (const c of CATEGORIES) prefs[c.id] = { ...c.defaults };
  return {
    timezone, prefs, dueWindows: [1440, 180, 60], digestTime: '07:30',
    quietHours: { enabled: true, start: '22:00', end: '07:00' }, missingAlerts: true,
  };
}

export function getUser(id: number): UserRow | undefined {
  return q.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}
export function allUsers(): UserRow[] {
  return q.all<UserRow>('SELECT * FROM users');
}
export function getSettings(user: UserRow): Settings {
  const base = defaultSettings();
  try {
    const s = JSON.parse(user.settings_json || '{}');
    const merged: Settings = { ...base, ...s, quietHours: { ...base.quietHours, ...(s.quietHours ?? {}) }, prefs: { ...base.prefs } };
    for (const [k, v] of Object.entries(s.prefs ?? {})) merged.prefs[k] = { ...(base.prefs[k] ?? {}), ...(v as object) };
    return merged;
  } catch { return base; }
}
export function saveSettings(userId: number, s: Settings) {
  q.run('UPDATE users SET settings_json = ? WHERE id = ?', JSON.stringify(s), userId);
}
export function freqFor(settings: Settings, category: Category | string, channel: Channel): Frequency {
  return settings.prefs[category]?.[channel] ?? CATEGORIES.find(c => c.id === category)?.defaults[channel] ?? 'never';
}

export function upsertUser(input: {
  auth_mode: UserRow['auth_mode']; canvas_base_url: string; canvas_user_id: string; name: string;
  avatar_url?: string | null; primary_email?: string | null; access_token?: string | null; refresh_token?: string | null;
  token_expires_at?: number | null; timezone?: string;
}): UserRow {
  const existing = q.get<UserRow>('SELECT * FROM users WHERE canvas_base_url = ? AND canvas_user_id = ?', input.canvas_base_url, input.canvas_user_id);
  if (existing) {
    q.run(`UPDATE users SET name = ?, avatar_url = ?, primary_email = ?, access_token = COALESCE(?, access_token),
           refresh_token = COALESCE(?, refresh_token), token_expires_at = COALESCE(?, token_expires_at), auth_mode = ? WHERE id = ?`,
      input.name, input.avatar_url ?? null, input.primary_email ?? null, input.access_token ?? null,
      input.refresh_token ?? null, input.token_expires_at ?? null, input.auth_mode, existing.id);
    return getUser(existing.id)!;
  }
  const settings = defaultSettings(input.timezone ?? 'UTC');
  const r = q.run(`INSERT INTO users (auth_mode, canvas_base_url, canvas_user_id, name, avatar_url, primary_email, access_token,
                   refresh_token, token_expires_at, settings_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    input.auth_mode, input.canvas_base_url, input.canvas_user_id, input.name, input.avatar_url ?? null, input.primary_email ?? null,
    input.access_token ?? null, input.refresh_token ?? null, input.token_expires_at ?? null, JSON.stringify(settings), now());
  return getUser(Number(r.lastInsertRowid))!;
}

// ---------- sessions ----------
const sign = (v: string) => createHmac('sha256', config.sessionSecret).update(v).digest('base64url');

export function createSession(userId: number): string {
  const id = randomBytes(24).toString('base64url');
  q.run('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)', id, userId, now());
  return `${id}.${sign(id)}`;
}
export function readSession(cookie: string | undefined): UserRow | undefined {
  if (!cookie) return undefined;
  const [id, sig] = cookie.split('.');
  if (!id || !sig || sign(id) !== sig) return undefined;
  const s = q.get<{ user_id: number }>('SELECT user_id FROM sessions WHERE id = ?', id);
  return s ? getUser(s.user_id) : undefined;
}
export function destroySession(cookie: string | undefined) {
  const id = cookie?.split('.')[0];
  if (id) q.run('DELETE FROM sessions WHERE id = ?', id);
}

// ---------- time helpers ----------
export function localParts(ms: number, tz: string): { hh: number; mm: number; ymd: string; weekday: string } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { hh: Number(p.hour) % 24, mm: Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday };
}
export function isQuietNow(settings: Settings, ms = now()): boolean {
  if (!settings.quietHours.enabled) return false;
  const { hh, mm } = localParts(ms, settings.timezone);
  const cur = hh * 60 + mm;
  const [sh, sm] = settings.quietHours.start.split(':').map(Number);
  const [eh, em] = settings.quietHours.end.split(':').map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
/** Epoch ms of the next moment quiet hours end. */
export function quietHoursEnd(settings: Settings, ms = now()): number {
  const [eh, em] = settings.quietHours.end.split(':').map(Number);
  for (let t = ms; t < ms + 26 * 3_600_000; t += 60_000) {
    const { hh, mm } = localParts(t, settings.timezone);
    if (hh === eh && mm === em) return t;
  }
  return ms + 8 * 3_600_000;
}
