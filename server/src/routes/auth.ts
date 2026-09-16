import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { CanvasClient } from '../canvas/client.js';
import { resetWorld } from '../canvas/mock.js';
import { upsertUser, createSession, destroySession, getSettings, saveSettings } from '../users.js';
import { syncUser } from '../sync/engine.js';
import { now } from '../db.js';

export const auth = Router();
const COOKIE = 'dsid';
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 30 * 24 * 3600 * 1000 };

function normalizeBase(url: string): string {
  let u = (url || '').trim();
  if (!u) throw new Error('Canvas URL is required');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  return `${parsed.protocol}//${parsed.host}`;
}

async function finishLogin(res: any, userId: number) {
  const sid = await createSession(userId);
  res.cookie(COOKIE, sid, cookieOpts);
}

auth.get('/auth/capabilities', (_req, res) => {
  res.json({ oauth: config.canvasOAuth.enabled, smtp: config.smtp.enabled, sms: config.twilio.enabled, syncIntervalMinutes: config.syncIntervalMs / 60000 });
});

/** Demo login: creates an isolated simulated Canvas for this browser. */
auth.post('/auth/demo', async (req, res) => {
  const name = String(req.body?.name || 'Demo Student').slice(0, 60);
  const tz = String(req.body?.timezone || 'UTC');
  const user = await upsertUser({ auth_mode: 'demo', canvas_base_url: 'https://canvas.demo.edu', canvas_user_id: `demo-${randomBytes(4).toString('hex')}`, name, primary_email: 'student@canvas.demo.edu', timezone: tz });
  await resetWorld(`u${user.id}`, name);
  const s = getSettings(user); s.timezone = tz; await saveSettings(user.id, s);
  await finishLogin(res, user.id);
  await syncUser(user.id, { initial: true });
  res.json({ ok: true });
});

/** Personal access token login (Canvas → Account → Settings → New Access Token). */
auth.post('/auth/token', async (req, res) => {
  try {
    const base = normalizeBase(String(req.body?.base_url || ''));
    const token = String(req.body?.token || '').trim();
    const tz = String(req.body?.timezone || 'UTC');
    if (!token) return res.status(400).json({ error: 'Access token is required' });
    const client = new CanvasClient(base, token);
    const profile = await client.profile();
    const user = await upsertUser({ auth_mode: 'token', canvas_base_url: base, canvas_user_id: profile.id, name: profile.name, avatar_url: profile.avatar_url, primary_email: profile.primary_email, access_token: token, timezone: tz });
    const s = getSettings(user); s.timezone = tz; await saveSettings(user.id, s);
    await finishLogin(res, user.id);
    res.json({ ok: true });
    void syncUser(user.id, { initial: user.last_sync_at == null });
  } catch (e: any) {
    res.status(401).json({ error: e?.message?.includes('401') ? 'Canvas rejected that token. Check the URL and token.' : (e?.message ?? 'Login failed') });
  }
});

/** OAuth2 (requires a Developer Key from a Canvas admin, see .env.example). */
auth.get('/auth/canvas/start', (req, res) => {
  if (!config.canvasOAuth.enabled) return res.status(400).send('OAuth is not configured on this server. Set CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET.');
  try {
    const base = normalizeBase(String(req.query.base_url || ''));
    const state = randomBytes(16).toString('hex');
    res.cookie('oauth_state', JSON.stringify({ state, base, tz: String(req.query.timezone || 'UTC') }), { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60_000, path: '/' });
    const url = new URL(`${base}/login/oauth2/auth`);
    url.searchParams.set('client_id', config.canvasOAuth.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', `${config.serverUrl}/auth/canvas/callback`);
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (e: any) { res.status(400).send(e.message); }
});

auth.get('/auth/canvas/callback', async (req, res) => {
  try {
    const raw = req.cookies?.oauth_state;
    if (!raw) throw new Error('Missing OAuth state');
    const { state, base, tz } = JSON.parse(raw);
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (req.query.state !== state) throw new Error('State mismatch');
    const tokenRes = await fetch(`${base}/login/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.canvasOAuth.clientId, client_secret: config.canvasOAuth.clientSecret, redirect_uri: `${config.serverUrl}/auth/canvas/callback`, code: String(req.query.code) }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const tok = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number; user: { id: number; name: string } };
    const client = new CanvasClient(base, tok.access_token);
    const profile = await client.profile().catch(() => ({ id: String(tok.user.id), name: tok.user.name } as any));
    const user = await upsertUser({ auth_mode: 'oauth', canvas_base_url: base, canvas_user_id: String(profile.id), name: profile.name, avatar_url: profile.avatar_url, primary_email: profile.primary_email, access_token: tok.access_token, refresh_token: tok.refresh_token ?? null, token_expires_at: tok.expires_in ? now() + tok.expires_in * 1000 : null, timezone: tz });
    const s = getSettings(user); s.timezone = tz; await saveSettings(user.id, s);
    res.clearCookie('oauth_state');
    await finishLogin(res, user.id);
    void syncUser(user.id, { initial: user.last_sync_at == null });
    res.redirect(config.appUrl);
  } catch (e: any) {
    res.redirect(`${config.appUrl}/login?error=${encodeURIComponent(e.message ?? 'OAuth failed')}`);
  }
});

auth.post('/auth/logout', async (req, res) => {
  await destroySession(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

export const SESSION_COOKIE = COOKIE;
