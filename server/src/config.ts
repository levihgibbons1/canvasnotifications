import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (no dependency): reads ../../.env if present.
const envPath = resolve(process.cwd(), '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = (k: string, d = '') => process.env[k] ?? d;
// SERVER_PORT always wins when set explicitly (local dev, where dev tooling may already
// export a PORT for an unrelated process). Otherwise fall back to PORT, which is what
// hosts like Render/Railway inject and require the app to bind to.
const port = Number(env('SERVER_PORT') || env('PORT') || '8787');

// Render (and Railway) inject the service's own public URL at runtime — use it as the
// default so a fresh deploy works without a manual second deploy to set APP_URL/SERVER_URL.
const platformUrl = env('RENDER_EXTERNAL_URL');

export const config = {
  port,
  isProd: env('NODE_ENV') === 'production',
  /** Where the browser app lives (Vite dev server in dev, this server in prod). */
  appUrl: env('APP_URL', platformUrl || (env('NODE_ENV') === 'production' ? `http://localhost:${port}` : 'http://localhost:5173')),
  serverUrl: env('SERVER_URL', platformUrl || `http://localhost:${port}`),
  sessionSecret: env('SESSION_SECRET', 'dispatch-dev-secret'),
  dbPath: env('DB_PATH', resolve(process.cwd(), '..', 'data', 'dispatch.sqlite')),
  /** Postgres connection string (e.g. Supabase). Unset means fall back to the local SQLite file. */
  databaseUrl: env('DATABASE_URL') || undefined,
  syncIntervalMs: Number(env('SYNC_INTERVAL_MINUTES', '5')) * 60_000,
  canvasOAuth: {
    clientId: env('CANVAS_CLIENT_ID'),
    clientSecret: env('CANVAS_CLIENT_SECRET'),
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },
  smtp: {
    host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '587')),
    user: env('SMTP_USER'), pass: env('SMTP_PASS'),
    from: env('SMTP_FROM', 'Dispatch <dispatch@example.com>'),
    get enabled() { return Boolean(this.host); },
  },
  // HTTP-API email transport. Prefer this over SMTP on hosts that block outbound SMTP
  // ports (e.g. Render's free tier, since September 2025) — HTTPS isn't blocked.
  // Brevo, not SendGrid: SendGrid discontinued its free plan in May 2025 (paid only now).
  brevo: {
    apiKey: env('BREVO_API_KEY'),
    from: env('SMTP_FROM', 'Dispatch <dispatch@example.com>'),
    get enabled() { return Boolean(this.apiKey); },
  },
  twilio: {
    sid: env('TWILIO_ACCOUNT_SID'), token: env('TWILIO_AUTH_TOKEN'), from: env('TWILIO_FROM'),
    get enabled() { return Boolean(this.sid && this.token && this.from); },
  },
};
