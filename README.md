# Dispatch for Canvas

An all-in-one notifications hub for Canvas LMS. Sign in with Canvas, and Dispatch watches your courses and tells you what changed, where you actually look: browser push, email, and text, with reminders, missing-work alerts, quiet hours, and a daily digest.

## What it does

| Canvas gives you | Dispatch gives you |
| --- | --- |
| A buried, per-channel settings grid with 30+ opaque categories | One feed of everything that changed, grouped by day, filterable by type and course |
| No due-date reminders | Reminders 1 day / 3 hours / 1 hour before anything unsubmitted is due (configurable), plus custom reminders |
| Grade emails with no score in them | "Lab 3: 46 / 50 (92%)" the moment it posts, and a separate alert when a grade changes |
| Nothing for missing work until it is a zero | A missing alert the moment a deadline passes with nothing turned in |
| Email only, or nothing | Push, email, and SMS per category, each set to Now / Digest / Off |
| Notifications at 3am | Quiet hours that hold alerts until morning, and one digest at the time you pick |

## How it works

```
Canvas REST API ──► sync engine (every 5 min) ──► diff vs snapshot ──► notifications
                                                                          │
   time rules (every 1 min): due-soon windows, missing work, custom reminders
                                                                          ▼
                                       preference matrix + quiet hours + digests
                                                                          ▼
                                            in-app feed · web push · email · SMS
```

- `server/src/canvas/client.ts`: a small paginating Canvas API client (courses with total scores, assignments with submissions and comments, announcements, conversations, discussion topics).
- `server/src/canvas/mock.ts`: a simulated institution for demo mode that can be nudged ("instructor posts a grade") so the whole pipeline can be exercised without a developer key.
- `server/src/sync/engine.ts`: pulls Canvas state, diffs it against the last snapshot, emits notifications; evaluates the time-based rules.
- `server/src/notify/deliver.ts`: turns notifications into deliveries per channel, honoring preferences, quiet hours, and digests. Without SMTP or Twilio configured, email and SMS are recorded as *simulated* and shown in the Outbox page.
- `client/`: React + Vite + Tailwind app. Pages: Feed, Upcoming (with reminders), Courses (grades, mute), Outbox, Settings.

Data lives in `data/dispatch.sqlite` (Node's built-in `node:sqlite`) by default, or in Postgres if `DATABASE_URL` is set — see Deploying below.

## Run it

Requires Node 22.13+ (uses `node:sqlite`).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/auth` to the Express server on port 8787.

Production-style: `npm run build` then `npm start`, and open http://localhost:8787.

## Signing in

1. **Demo**: creates a simulated Canvas with four courses. Use the "Simulate Canvas activity" button to post grades, comments, announcements, and messages and watch them flow through.
2. **Access token**: works with any real Canvas account today. In Canvas go to Account → Settings → Approved Integrations → New Access Token. Paste the token and your Canvas URL.
3. **Canvas login (OAuth2)**: the proper flow for a multi-user deployment. A Canvas admin must create a Developer Key with redirect URI `http://localhost:8787/auth/canvas/callback`. Put the key's ID and secret in `.env` (see `.env.example`).

## Optional delivery transports

Copy `.env.example` to `.env`:

- `SMTP_*` to send real email.
- `TWILIO_*` to send real texts.
- Browser push works out of the box (VAPID keys are generated on first run) once you click "Enable on this device" in Settings.

## Deploying

Dispatch is a long-running server: it polls Canvas on a timer, evaluates reminders every minute, and keeps state in a SQLite file. That needs a host that runs a persistent Node process, not a serverless one — **Vercel does not fit** (see note below). Render's free tier does, and one service hosts both the API and the built frontend. (Checked September 2026: Fly.io and Railway no longer have a real no-card free tier — both require a credit card after a short trial — and Northflank's always-on free Sandbox also requires a card and explicitly disclaims production use. Render remains the only genuinely free, no-card option that fits this app's architecture.)

**Deploy to Render (free) — one click via Blueprint:**

1. Push this repo to GitHub (already done if you're reading this from there).
2. On [render.com](https://render.com), **New → Blueprint**, connect the repo. Render reads [`render.yaml`](render.yaml) and provisions the web service on the free plan automatically (build/start commands, `SESSION_SECRET` auto-generated, `APP_URL`/`SERVER_URL` self-detected from Render's injected URL — no second deploy needed).
3. Deploy. First build takes a few minutes.
4. Optionally, in the service's Environment tab, fill in `SMTP_*` and/or `TWILIO_*` to turn on real email/text (see below) — they're pre-declared in the Blueprint as blank/secret so Render prompts for them without committing anything to the repo.

(No `render.yaml`, or prefer the dashboard? **New → Web Service**, connect the repo, Build Command `npm install && npm run build`, Start Command `npm start`, Instance Type Free — same result, more manual steps.)

**Two tradeoffs on the free tier, and how to work around the first one:**

- **Sleep.** The service spins down after 15 minutes with no traffic; the next request takes 30–60s to wake it. Workaround: a free external uptime pinger (e.g. [UptimeRobot](https://uptimerobot.com), cron-job.org) hitting the app's URL every ~10 minutes keeps it awake, since *any* HTTP request resets the idle timer — just don't ping `/robots.txt`, Render answers that one itself without waking the service. Render's free plan includes 750 instance-hours/workspace/month, and a full month is ~730 hours, so one service pinged 24/7 just fits.
- **No persistent disk.** The filesystem is ephemeral — every spin-down/wake cycle *and* every redeploy wipes the SQLite file (settings, notification history, your Canvas connection, all of it). A keep-alive ping avoids the routine sleep-triggered wipes, but not the ones from a redeploy or a Render-side restart. The real fix — and what this repo is set up for — is a hosted Postgres database instead of the local SQLite file.

**Real persistence: Supabase Postgres (free, no card required as of Sept 2026):**

Dispatch's storage layer (`server/src/db.ts`) auto-switches backends based on one env var:
- `DATABASE_URL` unset → local SQLite file (`data/dispatch.sqlite`). Zero setup, great for local dev, ephemeral in prod.
- `DATABASE_URL` set to a Postgres connection string → uses that instead, with the same schema. State survives redeploys and restarts.

To wire it up:
1. Create a free project at [supabase.com](https://supabase.com) (sign in with GitHub).
2. In the new project: **Project Settings → Database → Connection string → URI**. Copy it (it looks like `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres`).
3. Add it as `DATABASE_URL` in Render's Environment tab (already pre-declared in `render.yaml` as a secret, so it'll prompt for it) — or in your local `.env` for testing.
4. Redeploy (or restart locally). On first boot Dispatch creates its tables automatically (`CREATE TABLE IF NOT EXISTS ...`) — no separate migration step.

This doesn't remove the *sleep* tradeoff (still worth the keep-alive ping above), but it does mean a sleep/wake cycle, a redeploy, or a Render restart no longer erases notification history, settings, or Canvas connections.

**Vercel note.** Vercel runs serverless functions: no background process between requests, free-tier cron limited to once a day, and no writable disk shared across requests. Dispatch's 5-minute sync, 1-minute reminder checks, and SQLite file all depend on exactly what serverless doesn't provide. Making it fit would mean moving sync/reminders to Vercel Cron (per-minute schedules need the paid Pro plan) and replacing SQLite with a hosted database like Turso or Postgres — a real rewrite, not a deploy setting. Vercel remains a good fit if you only want to host the static `client/dist` build with the API elsewhere, though that split needs CORS and cross-site cookie support added to the server first.

## Prototype limits

- Tokens are stored unencrypted (SQLite file or Postgres row, whichever backend is active). Encrypt at rest before pointing this at a real institution's users.
- Sync polls Canvas; Canvas Live Events (Caliper/webhooks) would cut latency for institutions that enable them.
- Email and SMS channel addresses are not verified with a confirmation code yet.
