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
// Deliberately not the generic PORT variable: dev tooling often sets PORT for the Vite client.
const port = Number(env('SERVER_PORT', '8787'));

export const config = {
  port,
  isProd: env('NODE_ENV') === 'production',
  /** Where the browser app lives (Vite dev server in dev, this server in prod). */
  appUrl: env('APP_URL', env('NODE_ENV') === 'production' ? `http://localhost:${port}` : 'http://localhost:5173'),
  serverUrl: env('SERVER_URL', `http://localhost:${port}`),
  sessionSecret: env('SESSION_SECRET', 'dispatch-dev-secret'),
  dbPath: env('DB_PATH', resolve(process.cwd(), '..', 'data', 'dispatch.sqlite')),
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
  twilio: {
    sid: env('TWILIO_ACCOUNT_SID'), token: env('TWILIO_AUTH_TOKEN'), from: env('TWILIO_FROM'),
    get enabled() { return Boolean(this.sid && this.token && this.from); },
  },
};
