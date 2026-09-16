import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { api, relTime } from '../api';
import { useApp, Spinner } from '../App';

const NAV = [
  { to: '/', n: '01', label: 'Feed', hint: 'Everything that changed' },
  { to: '/upcoming', n: '02', label: 'Upcoming', hint: 'Due dates & reminders' },
  { to: '/courses', n: '03', label: 'Courses', hint: 'Grades, mute per course' },
  { to: '/outbox', n: '04', label: 'Outbox', hint: 'Sent push, email, texts' },
  { to: '/settings', n: '05', label: 'Settings', hint: 'Channels & preferences' },
];

const SIM_KINDS: { kind: string; label: string }[] = [
  { kind: 'grade', label: 'Instructor posts a grade' },
  { kind: 'regrade', label: 'Instructor changes a grade' },
  { kind: 'comment', label: 'Feedback comment' },
  { kind: 'announcement', label: 'Course announcement' },
  { kind: 'assignment', label: 'New assignment published' },
  { kind: 'due_change', label: 'Due date moved' },
  { kind: 'message', label: 'Inbox message' },
  { kind: 'discussion', label: 'Discussion replies' },
];

export default function Shell() {
  const { me, refresh, toast } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const simRef = useRef<HTMLDivElement>(null);
  const user = me!.user;
  const firstSync = me!.syncing && !user.last_sync_at;

  // Poll faster while a sync is running so the UI flips as soon as it finishes.
  useEffect(() => {
    const t = setInterval(() => void refresh(), me!.syncing ? 2_500 : 30_000);
    return () => clearInterval(t);
  }, [refresh, me!.syncing]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (simRef.current && !simRef.current.contains(e.target as Node)) setSimOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>('/sync');
      toast(r.created ? `Synced · ${r.created} new notification${r.created === 1 ? '' : 's'}` : 'Synced · nothing new');
      window.dispatchEvent(new Event('dispatch:refresh'));
    } catch (e: any) { toast(`Sync failed: ${e.message}`, 'err'); }
    finally { await refresh(); setBusy(false); }
  };
  const simulate = async (kind?: string) => {
    setSimOpen(false); setBusy(true);
    try {
      const r = await api.post<{ message: string; created: number }>('/demo/simulate', { kind });
      toast(`${r.message} → ${r.created} notification${r.created === 1 ? '' : 's'}`);
      window.dispatchEvent(new Event('dispatch:refresh'));
    } catch (e: any) { toast(e.message, 'err'); }
    finally { await refresh(); setBusy(false); }
  };
  const logout = async () => { await api.auth('/logout'); await refresh(); nav('/login'); };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="border-b lg:border-b-0 lg:border-r border-line bg-paper-2/60 backdrop-blur-sm lg:sticky lg:top-0 lg:h-screen flex flex-col">
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-block h-3 w-3 rounded-full bg-signal pulse-dot" />
            <span className="display text-[26px] font-semibold tracking-tight leading-none">Dispatch</span>
          </div>
          <div className="eyebrow mt-2">for Canvas</div>
        </div>

        <nav className="px-3 flex lg:flex-col gap-0.5 overflow-x-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-paper-3/70 hover:text-ink'}`}>
              {({ isActive }) => (<>
                <span className={`mono text-[10px] tracking-widest ${isActive ? 'text-paper/60' : 'text-ink-3'}`}>{item.n}</span>
                <span className="min-w-0">
                  <span className="block font-medium leading-tight">{item.label}</span>
                  <span className={`hidden lg:block text-[11px] leading-tight ${isActive ? 'text-paper/60' : 'text-ink-3'}`}>{item.hint}</span>
                </span>
                {item.to === '/' && me!.unread > 0 && <span className="ml-auto mono text-[10px] rounded-full px-1.5 py-0.5 bg-signal text-white">{me!.unread}</span>}
              </>)}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-4 pb-5 pt-6 space-y-3">
          {/* ---- Canvas connection status ---- */}
          <div className="card p-3.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Canvas sync</span>
              <SyncBadge syncing={me!.syncing} error={user.last_sync_error} lastSync={user.last_sync_at} />
            </div>
            <div className="mt-1.5 text-xs text-ink-2 leading-snug">
              {me!.syncing ? (firstSync ? 'Importing your courses for the first time…' : 'Checking Canvas for changes…')
                : user.last_sync_error ? <span className="text-signal">Last sync failed. <Link to="/settings#connection" className="underline">See why</Link></span>
                : user.last_sync_at ? <>Up to date as of {relTime(user.last_sync_at)}. {me!.courseCount} course{me!.courseCount === 1 ? '' : 's'} tracked; checks again every {me!.capabilities.syncIntervalMinutes} min.</>
                : 'Waiting for the first sync…'}
            </div>
            <button className="btn btn-ghost w-full justify-center mt-3" disabled={busy || me!.syncing} onClick={sync}>
              {busy || me!.syncing ? <Spinner /> : <span>↻</span>} {me!.syncing ? 'Syncing…' : 'Sync now'}
            </button>
            {user.auth_mode === 'demo' && (
              <div className="relative mt-2" ref={simRef}>
                <button className="btn btn-signal w-full justify-center" disabled={busy} onClick={() => setSimOpen(o => !o)}>
                  <span>⚡</span> Simulate Canvas activity <span className="ml-auto text-xs opacity-70">{simOpen ? '▴' : '▾'}</span>
                </button>
                {simOpen && (
                  <div className="absolute bottom-full mb-2 left-0 right-0 card p-1.5 z-20 shadow-[var(--shadow-pop)]">
                    <div className="px-3 pt-1.5 pb-1 eyebrow">Pretend an instructor…</div>
                    <button className="w-full text-left rounded-md px-3 py-1.5 text-sm font-medium hover:bg-paper-2" onClick={() => simulate()}>Does something random</button>
                    <div className="my-1 border-t border-line" />
                    {SIM_KINDS.map(k => <button key={k.kind} className="w-full text-left rounded-md px-3 py-1.5 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink" onClick={() => simulate(k.kind)}>{k.label}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- account ---- */}
          <div className="card p-3.5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-ink text-paper grid place-items-center display text-base overflow-hidden">
                {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : user.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{user.name}</div>
                <div className="mono text-[10px] text-ink-3 truncate" title={user.canvas_base_url}>
                  {user.auth_mode === 'demo' ? 'Demo · simulated Canvas' : user.canvas_base_url.replace(/^https?:\/\//, '')}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/settings#connection" className="btn btn-ghost justify-center py-1.5 text-xs">Connection</Link>
              <button onClick={logout} className="btn btn-ghost justify-center py-1.5 text-xs hover:border-signal hover:text-signal">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <main className="px-5 py-6 lg:px-10 lg:py-9 max-w-6xl w-full">
        {user.last_sync_error && !me!.syncing && (
          <div className="mb-6 rounded-xl border border-signal/40 bg-signal/8 px-4 py-3 flex flex-wrap items-center gap-3 rise">
            <span className="text-signal text-lg leading-none">!</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-signal-deep">Couldn't sync with Canvas</div>
              <div className="text-sm text-ink-2 mono break-all">{user.last_sync_error}</div>
            </div>
            <button className="btn btn-ghost" disabled={busy} onClick={sync}>Retry</button>
            <Link to="/settings#connection" className="btn btn-primary">Check connection</Link>
          </div>
        )}
        {firstSync && (
          <div className="mb-6 card px-4 py-3 flex items-center gap-3 rise">
            <Spinner />
            <div className="text-sm text-ink-2"><span className="font-semibold text-ink">Importing from Canvas.</span> Pulling courses, assignments, grades, announcements and inbox. A few seconds per course.</div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

function SyncBadge({ syncing, error, lastSync }: { syncing: boolean; error: string | null; lastSync: number | null }) {
  const [label, cls] = syncing ? ['syncing', 'border-navy/40 text-navy bg-navy/5']
    : error ? ['error', 'border-signal/50 text-signal bg-signal/5']
    : lastSync ? ['connected', 'border-moss/40 text-moss bg-moss/5']
    : ['pending', 'border-line text-ink-3'];
  return <span className={`mono text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${cls}`}>{label}</span>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7 rise">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display text-4xl lg:text-[44px] font-medium tracking-tight leading-[1.05] mt-1">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
