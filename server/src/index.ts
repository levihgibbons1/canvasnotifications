import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import './db.js';
import { auth } from './routes/auth.js';
import { api } from './routes/api.js';
import { syncAllUsers, evaluateAllTimeRules } from './sync/engine.js';
import { processQueue, processDigests } from './notify/deliver.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// tiny cookie parser
app.use((req, _res, next) => {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  (req as any).cookies = out;
  next();
});

app.use(auth);
app.use('/api', api);

// Serve the built client in production.
const dist = resolve(process.cwd(), '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/auth).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? 'Server error' });
});

app.listen(config.port, () => {
  console.log(`Dispatch server on ${config.serverUrl} (app: ${config.appUrl})`);
  console.log(`  OAuth: ${config.canvasOAuth.enabled ? 'configured' : 'not configured (token + demo login available)'} · Email: ${config.brevo.enabled || config.smtp.enabled ? 'on' : 'simulated'} · SMS: ${config.twilio.enabled ? 'on' : 'simulated'}`);
});

// ---------- background loops ----------
const tick = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error(`[${name}]`, e); } };
setTimeout(() => void tick('sync', syncAllUsers), 15_000);
setInterval(() => void tick('sync', syncAllUsers), config.syncIntervalMs);
setInterval(() => void tick('rules', evaluateAllTimeRules), 60_000);
setInterval(() => void tick('queue', processQueue), 30_000);
setInterval(() => void tick('digest', processDigests), 60_000);
