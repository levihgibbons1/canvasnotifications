export class AuthError extends Error {}

async function call<T>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401) throw new AuthError('Not signed in');
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>(`/api${path}`),
  post: <T>(path: string, body?: unknown) => call<T>(`/api${path}`, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => call<T>(`/api${path}`, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => call<T>(`/api${path}`, { method: 'PATCH', body }),
  del: <T>(path: string) => call<T>(`/api${path}`, { method: 'DELETE' }),
  auth: <T>(path: string, body?: unknown) => call<T>(`/auth${path}`, { method: 'POST', body }),
};

export type Channel = 'push' | 'email' | 'sms';
export type Frequency = 'immediately' | 'daily' | 'never';
export type Category =
  | 'grade_posted' | 'grade_changed' | 'submission_comment' | 'announcement' | 'assignment_created'
  | 'due_date_changed' | 'due_reminder' | 'missing_assignment' | 'conversation_message'
  | 'discussion_reply' | 'reminder' | 'digest';

export interface CategoryDef { id: Category; label: string; group: string; description: string; defaults: Record<Channel, Frequency>; }

export interface Me {
  user: { id: number; name: string; avatar_url: string | null; email: string | null; auth_mode: 'demo' | 'token' | 'oauth'; canvas_base_url: string; last_sync_at: number | null; last_sync_error: string | null };
  settings: Settings;
  unread: number;
  syncing: boolean;
  courseCount: number;
  categories: CategoryDef[];
  capabilities: { oauth: boolean; smtp: boolean; sms: boolean; syncIntervalMinutes: number };
}

export interface Settings {
  timezone: string;
  prefs: Record<string, Partial<Record<Channel, Frequency>>>;
  dueWindows: number[];
  digestTime: string;
  quietHours: { enabled: boolean; start: string; end: string };
  missingAlerts: boolean;
}

export interface Notification {
  id: number; category: Category; title: string; body: string; course_id: string | null; course_name: string | null;
  url: string | null; meta: Record<string, any>; is_read: boolean; created_at: number;
}

export interface Course { canvas_id: string; name: string; course_code: string; term: string | null; current_score: number | null; current_grade: string | null; muted: boolean; html_url: string; }

export interface UpcomingItem {
  key: string; id: string; course_id: string; course_name: string; course_code: string; name: string; due_at: string | null; due_ms: number | null;
  points_possible: number | null; html_url: string; status: 'todo' | 'submitted' | 'graded' | 'missing' | 'excused'; score: number | null; grade: string | null;
  submission_types: string[]; reminders: Reminder[];
}
export interface Reminder { id: number; assignment_key: string | null; title: string; note: string | null; remind_at: number; fired: number; }

export interface Delivery {
  id: number; channel: Channel; address: string; status: string; subject: string; body: string; error: string | null;
  send_after: number | null; created_at: number; sent_at: number | null; category: Category | null; url: string | null;
}

export interface Stats { unread: number; gradesWeek: number; dueWeek: number; missing: number; inbox: number; }

// ---------- presentation helpers ----------
export const CATEGORY_STYLE: Record<Category, { color: string; label: string; glyph: string }> = {
  grade_posted: { color: 'var(--color-moss)', label: 'Grade posted', glyph: '✓' },
  grade_changed: { color: 'var(--color-moss)', label: 'Grade changed', glyph: '±' },
  submission_comment: { color: 'var(--color-plum)', label: 'Feedback', glyph: '❝' },
  announcement: { color: 'var(--color-navy)', label: 'Announcement', glyph: '◉' },
  assignment_created: { color: 'var(--color-teal)', label: 'New assignment', glyph: '+' },
  due_date_changed: { color: 'var(--color-gold)', label: 'Due date moved', glyph: '⇄' },
  due_reminder: { color: 'var(--color-signal)', label: 'Due soon', glyph: '◷' },
  missing_assignment: { color: 'var(--color-signal-deep)', label: 'Missing', glyph: '!' },
  conversation_message: { color: 'var(--color-teal)', label: 'Inbox', glyph: '✉' },
  discussion_reply: { color: 'var(--color-plum)', label: 'Discussion', glyph: '↩' },
  reminder: { color: 'var(--color-gold)', label: 'Reminder', glyph: '★' },
  digest: { color: 'var(--color-ink-2)', label: 'Digest', glyph: '≡' },
};

export const relTime = (ms: number) => {
  const d = Date.now() - ms;
  const abs = Math.abs(d);
  const s = d < 0 ? 'in ' : '';
  const e = d < 0 ? '' : ' ago';
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return `${s}${Math.round(abs / 60_000)} min${e}`;
  if (abs < 86_400_000) return `${s}${Math.round(abs / 3_600_000)} h${e}`;
  const days = Math.round(abs / 86_400_000);
  return `${s}${days} day${days === 1 ? '' : 's'}${e}`;
};
export const dayLabel = (ms: number) => {
  const d = new Date(ms), t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  const tm = new Date(t); tm.setDate(t.getDate() + 1);
  if (same(d, tm)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
export const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
