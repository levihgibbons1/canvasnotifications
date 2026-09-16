import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

type Row = Record<string, any>;
type RunResult = { lastInsertRowid?: number | bigint; changes?: number };

export const now = () => Date.now();

// Lets every call site keep writing SQLite-style `?` placeholders regardless of
// which backend is active — translated to Postgres `$1, $2, ...` only when needed.
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

let get: <T = Row>(sql: string, ...params: any[]) => Promise<T | undefined>;
let all: <T = Row>(sql: string, ...params: any[]) => Promise<T[]>;
let run: (sql: string, ...params: any[]) => Promise<RunResult>;
let kvGet: (key: string) => Promise<string | undefined>;
let kvSet: (key: string, value: string) => Promise<void>;
let kvDel: (key: string) => Promise<void>;

if (config.databaseUrl) {
  // ---------- Postgres backend (e.g. Supabase free tier) — persists across restarts/redeploys ----------
  const pg = await import('pg');
  // node-postgres parses bigint (COUNT(*), OID 20) as a string by default to avoid precision
  // loss. This app's counts never approach that limit, and every call site expects a number
  // (SQLite's COUNT(*) returns one natively) — parse it back to a number.
  pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      auth_mode TEXT NOT NULL,
      canvas_base_url TEXT NOT NULL,
      canvas_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      primary_email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at BIGINT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL,
      last_sync_at BIGINT,
      last_sync_error TEXT,
      UNIQUE(canvas_base_url, canvas_user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
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
      seen_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, kind, key)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
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
      created_at BIGINT NOT NULL,
      UNIQUE(user_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS deliveries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      error TEXT,
      send_after BIGINT,
      created_at BIGINT NOT NULL,
      sent_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_user ON deliveries(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      address TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL,
      UNIQUE(user_id, type, address)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription_json TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignment_key TEXT,
      title TEXT NOT NULL,
      note TEXT,
      remind_at BIGINT NOT NULL,
      fired INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  get = async <T = Row>(sql: string, ...params: any[]) => (await pool.query(toPgPlaceholders(sql), params)).rows[0] as T | undefined;
  all = async <T = Row>(sql: string, ...params: any[]) => (await pool.query(toPgPlaceholders(sql), params)).rows as T[];
  run = async (sql: string, ...params: any[]) => {
    const insertMatch = /^\s*insert\s+into\s+(\w+)/i.exec(sql);
    const hasReturning = /\breturning\b/i.test(sql);
    // courses, snapshot and kv use a composite/natural primary key, not a serial `id` column —
    // every other table does, so those three are excluded from the auto-RETURNING.
    const NO_ID_TABLE = new Set(['courses', 'snapshot', 'kv']);
    const text = insertMatch && !hasReturning && !NO_ID_TABLE.has(insertMatch[1].toLowerCase()) ? `${sql} RETURNING id` : sql;
    const res = await pool.query(toPgPlaceholders(text), params);
    return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount ?? 0 };
  };
} else {
  // ---------- SQLite backend — zero setup for local dev; ephemeral on hosts with no persistent disk ----------
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_mode TEXT NOT NULL,
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
      channel TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL,
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
      type TEXT NOT NULL,
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
      assignment_key TEXT,
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

  get = async <T = Row>(sql: string, ...params: any[]) => db.prepare(sql).get(...params) as T | undefined;
  all = async <T = Row>(sql: string, ...params: any[]) => db.prepare(sql).all(...params) as T[];
  run = async (sql: string, ...params: any[]) => db.prepare(sql).run(...params) as RunResult;
}

kvGet = async (key: string) => (await get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value;
kvSet = async (key: string, value: string) => { await run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); };
kvDel = async (key: string) => { await run('DELETE FROM kv WHERE key = ?', key); };

export const q = { get, all, run };
export const kv = { get: kvGet, set: kvSet, del: kvDel };
