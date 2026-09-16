import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_mode TEXT NOT NULL,              -- 'demo' | 'token' | 'oauth'
  canvas_base_url TEXT NOT NULL,
  canvas_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  primary_email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  last_sync_error TEXT,
  UNIQUE(canvas_base_url, canvas_user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvas_id TEXT NOT NULL,
  name TEXT NOT NULL,
  course_code TEXT,
  term TEXT,
  current_score REAL,
  current_grade TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  html_url TEXT,
  PRIMARY KEY (user_id, canvas_id)
);

-- Generic snapshot of remote objects, used to diff between syncs.
CREATE TABLE IF NOT EXISTS snapshot (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  data_json TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  course_id TEXT,
  course_name TEXT,
  url TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                -- 'push' | 'email' | 'sms'
  address TEXT,
  status TEXT NOT NULL,                 -- 'queued' | 'digest' | 'sent' | 'simulated' | 'failed' | 'skipped'
  subject TEXT,
  body TEXT,
  error TEXT,
  send_after INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deliveries_user ON deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- 'email' | 'sms'
  address TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, type, address)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_key TEXT,                  -- 'course_id:assignment_id' or NULL for free-form
  title TEXT NOT NULL,
  note TEXT,
  remind_at INTEGER NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

type Row = Record<string, any>;
export const q = {
  get<T = Row>(sql: string, ...params: any[]): T | undefined { return db.prepare(sql).get(...params) as T | undefined; },
  all<T = Row>(sql: string, ...params: any[]): T[] { return db.prepare(sql).all(...params) as T[]; },
  run(sql: string, ...params: any[]) { return db.prepare(sql).run(...params); },
};

export const kv = {
  get(key: string): string | undefined { return q.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value; },
  set(key: string, value: string) { q.run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); },
  del(key: string) { q.run('DELETE FROM kv WHERE key = ?', key); },
};

export const now = () => Date.now();
