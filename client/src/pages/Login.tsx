import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, tz } from '../api';
import { useApp, Spinner } from '../App';

const BASE_URL = 'https://pacificachristian.instructure.com';
const BASE_HOST = 'pacificachristian.instructure.com';

export default function Login() {
  const { refresh } = useApp();
  const [params] = useSearchParams();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));

  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr]">
      <section className="relative overflow-hidden px-8 py-8 lg:px-14 lg:py-12 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-line">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-signal/15 blur-3xl" />
        <div className="absolute right-0 bottom-10 h-80 w-80 rounded-full bg-navy/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5 rise">
          <span className="inline-block h-3 w-3 rounded-full bg-signal pulse-dot" />
          <span className="display text-2xl font-semibold tracking-tight">Dispatch</span>
          <span className="eyebrow ml-2 mt-1">for Canvas</span>
        </div>
        <div className="relative mt-10 lg:mt-0 max-w-xl">
          <h1 className="display text-4xl lg:text-[48px] leading-[1.02] font-medium tracking-tight rise" style={{ animationDelay: '80ms' }}>
            Every grade, comment, deadline and message from Canvas. <em className="italic font-light text-signal">One place.</em>
          </h1>
          <p className="mt-5 text-base lg:text-lg text-ink-2 leading-relaxed rise" style={{ animationDelay: '160ms' }}>
            Dispatch watches your courses, notices what changed, and tells you where you actually look: your phone, your inbox, your browser.
          </p>
          <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-ink-2 rise" style={{ animationDelay: '240ms' }}>
            {[
              ['Grades & feedback', 'the moment they post, with the score'],
              ['Reminders', '1 day, 3 hours, 1 hour before anything is due'],
              ['Missing work', 'flagged before it becomes a zero'],
              ['Email · SMS · push', 'per category, with quiet hours and a daily digest'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" /><span><strong className="font-semibold text-ink">{t}</strong> — {d}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-8 lg:px-14 lg:py-12 flex items-start lg:items-center">
        <div className="w-full max-w-xl mx-auto rise" style={{ animationDelay: '200ms' }}>
          <div className="eyebrow mb-2">Get started</div>
          <h2 className="display text-2xl lg:text-3xl font-medium tracking-tight">Connect your Canvas account</h2>

          <div className="card p-5 lg:p-6 mt-4">
            <Intro>Connect your Pacifica Christian Canvas account with a personal access token. Dispatch only <em>reads</em>: courses, assignments, grades, announcements and your inbox.</Intro>
            <Step n={1} title="Create an access token in Canvas">
              <ol className="text-sm text-ink-2 space-y-1.5 list-none">
                <li className="flex flex-wrap items-center gap-2"><Kbd>a</Kbd> <a className="btn btn-ghost py-1.5" href={`${BASE_URL}/profile/settings`} target="_blank" rel="noreferrer">Open Canvas settings ↗</a></li>
                <li><Kbd>b</Kbd> Scroll to <strong>Approved Integrations</strong> and click <strong>+ New Access Token</strong>.</li>
                <li><Kbd>c</Kbd> Purpose: <span className="mono">Dispatch</span>. Leave the expiry blank. Click <strong>Generate Token</strong>.</li>
                <li><Kbd>d</Kbd> Copy the token. Canvas shows it <em>only once</em>.</li>
              </ol>
              <p className="text-xs text-ink-3 mt-2">Don't see “+ New Access Token”? Ask Levi.</p>
            </Step>
            <Step n={2} title="Paste the token here" last>
              <input className="input mono text-xs" type="password" placeholder="1234~AbCdEf…" value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === 'Enter' && token && go(() => api.auth('/token', { base_url: BASE_URL, token, timezone: tz() }))} />
              <button className="btn btn-primary w-full justify-center mt-3" disabled={busy || !token.trim()} onClick={() => go(() => api.auth('/token', { base_url: BASE_URL, token: token.trim(), timezone: tz() }))}>
                {busy ? <><Spinner /> Checking with Canvas…</> : 'Connect & import my courses'}
              </button>
              <p className="text-xs text-ink-3 mt-2">Stored on this server only. Revoke it any time from {BASE_HOST} and Dispatch is cut off instantly.</p>
            </Step>

            {error && <div className="mt-4 rounded-lg bg-signal/10 border border-signal/30 px-3 py-2.5 text-sm text-signal-deep"><strong>Couldn't connect.</strong> {error}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function Intro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2 leading-relaxed mb-4">{children}</p>;
}

function Step({ n, title, children, last = false }: { n: number; title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`relative pl-10 ${last ? '' : 'pb-5'}`}>
      {!last && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" />}
      <span className="absolute left-0 top-0 h-7 w-7 rounded-full bg-ink text-paper grid place-items-center mono text-xs font-semibold">{n}</span>
      <div className="font-semibold text-[15px] leading-7 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <span className="inline-block w-5 mono text-[10px] text-ink-3 uppercase">{children}</span>;
}
