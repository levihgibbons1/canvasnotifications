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

Data lives in `data/dispatch.sqlite` using Node's built-in `node:sqlite`.

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

## Prototype limits

- Tokens are stored unencrypted in the SQLite file. Encrypt at rest before deploying.
- Sync polls Canvas; Canvas Live Events (Caliper/webhooks) would cut latency for institutions that enable them.
- Email and SMS channel addresses are not verified with a confirmation code yet.
