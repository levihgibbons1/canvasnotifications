import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dayLabel, timeOf, relTime, type UpcomingItem, type Reminder } from '../api';
import { useApp, Empty, Spinner } from '../App';
import { PageHeader } from '../components/Shell';

interface Data { upcoming: UpcomingItem[]; undated: UpcomingItem[]; freeReminders: Reminder[] }

const QUICK = [
  { label: '1 hour before', ms: 3_600_000 },
  { label: '3 hours before', ms: 3 * 3_600_000 },
  { label: 'The night before (8pm)', ms: -1 },
  { label: '1 day before', ms: 86_400_000 },
  { label: '2 days before', ms: 2 * 86_400_000 },
];

export default function Upcoming() {
  const { toast, me } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [freeTitle, setFreeTitle] = useState('');
  const [freeAt, setFreeAt] = useState('');

  const load = useCallback(async () => setData(await api.get<Data>('/upcoming')), []);
  useEffect(() => { void load(); const h = () => void load(); window.addEventListener('dispatch:refresh', h); return () => window.removeEventListener('dispatch:refresh', h); }, [load]);

  const items = useMemo(() => (data?.upcoming ?? []).filter(i => showDone || i.status === 'todo' || i.status === 'missing'), [data, showDone]);
  const groups = useMemo(() => {
    const g: { label: string; items: UpcomingItem[] }[] = [];
    for (const it of items) {
      const label = it.due_ms! < Date.now() && it.status === 'missing' ? 'Overdue' : dayLabel(it.due_ms!);
      const last = g[g.length - 1];
      if (last && last.label === label) last.items.push(it); else g.push({ label, items: [it] });
    }
    return g;
  }, [items]);

  const addReminder = async (it: UpcomingItem, ms: number) => {
    let at: number;
    if (ms === -1) { const d = new Date(it.due_ms!); d.setDate(d.getDate() - 1); d.setHours(20, 0, 0, 0); at = d.getTime(); }
    else at = it.due_ms! - ms;
    if (at < Date.now()) { toast('That time has already passed', 'err'); return; }
    await api.post('/reminders', { assignment_key: it.key, title: `Reminder: ${it.name}`, note: `${it.course_name} · due ${new Date(it.due_ms!).toLocaleString()}`, remind_at: at });
    setOpenKey(null); await load(); toast(`Reminder set for ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
  };
  const addCustom = async (it: UpcomingItem, local: string) => {
    const at = new Date(local).getTime();
    if (!at || at < Date.now()) { toast('Pick a time in the future', 'err'); return; }
    await api.post('/reminders', { assignment_key: it.key, title: `Reminder: ${it.name}`, note: `${it.course_name}`, remind_at: at });
    setOpenKey(null); await load(); toast('Reminder set');
  };
  const removeReminder = async (id: number) => { await api.del(`/reminders/${id}`); await load(); };
  const addFree = async () => {
    const at = new Date(freeAt).getTime();
    if (!freeTitle || !at) return;
    await api.post('/reminders', { title: freeTitle, remind_at: at });
    setFreeTitle(''); setFreeAt(''); await load(); toast('Reminder added');
  };

  const windows = me!.settings.dueWindows;

  return (
    <div>
      <PageHeader eyebrow="What's coming" title="Upcoming & reminders">
        <button className="chip" data-on={showDone} onClick={() => setShowDone(s => !s)}>Show submitted</button>
      </PageHeader>

      <div className="card p-4 mb-7 flex flex-wrap items-center gap-3 rise">
        <div className="eyebrow w-full sm:w-auto">Automatic reminders</div>
        <div className="text-sm text-ink-2">Everything unsubmitted gets a nudge {windows.map(fmtWindow).join(', ')} before it is due, plus a missing alert if the deadline passes. <a href="/settings" className="text-navy font-medium hover:text-signal">Change</a></div>
      </div>

      <div className="card p-4 mb-8 rise" style={{ animationDelay: '60ms' }}>
        <div className="eyebrow mb-2">Add your own reminder</div>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1 min-w-48" placeholder="e.g. Email Dr. Okafor about the lab makeup" value={freeTitle} onChange={e => setFreeTitle(e.target.value)} />
          <input className="input w-auto" type="datetime-local" value={freeAt} onChange={e => setFreeAt(e.target.value)} />
          <button className="btn btn-primary" onClick={addFree} disabled={!freeTitle || !freeAt}>Remind me</button>
        </div>
        {data?.freeReminders.filter(r => !r.fired).length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.freeReminders.filter(r => !r.fired).map(r => (
              <li key={r.id} className="py-2 flex items-center gap-3 text-sm">
                <span className="text-gold">★</span><span className="font-medium">{r.title}</span>
                <span className="mono text-[10px] text-ink-3 ml-auto">{new Date(r.remind_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <button className="text-xs text-ink-3 hover:text-signal" onClick={() => removeReminder(r.id)}>remove</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!data ? <div className="py-16 grid place-items-center"><Spinner /></div>
        : groups.length === 0 ? <Empty title="Nothing on the horizon.">Enjoy it while it lasts.</Empty>
        : groups.map((g, gi) => (
          <section key={g.label} className="mb-7 rise" style={{ animationDelay: `${120 + gi * 40}ms` }}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className={`display text-xl font-medium ${g.label === 'Overdue' ? 'text-signal' : ''}`}>{g.label}</h2>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="space-y-2">
              {g.items.map(it => (
                <div key={it.key} className="card px-4 py-3">
                  <div className="flex items-start gap-4">
                    <div className="w-16 shrink-0">
                      <div className="mono text-xs font-semibold">{timeOf(it.due_ms!)}</div>
                      <div className="mono text-[10px] text-ink-3">{relTime(it.due_ms!)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="mono text-[10px] uppercase tracking-widest text-ink-3">{it.course_code}</span>
                        <StatusPill status={it.status} score={it.score} points={it.points_possible} />
                        {it.points_possible != null && it.status === 'todo' && <span className="mono text-[10px] text-ink-3">{it.points_possible} pts</span>}
                      </div>
                      <a href={it.html_url} target="_blank" rel="noreferrer" className="block mt-0.5 font-semibold text-[15px] hover:text-signal">{it.name}</a>
                      <div className="text-xs text-ink-3 mt-0.5">{it.course_name}</div>
                      {it.reminders.filter(r => !r.fired).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {it.reminders.filter(r => !r.fired).map(r => (
                            <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 border border-gold/30 px-2 py-0.5 text-[11px] text-gold">
                              ★ {new Date(r.remind_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                              <button className="hover:text-signal" onClick={() => removeReminder(r.id)}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {(it.status === 'todo' || it.status === 'missing') && (
                      <div className="relative shrink-0">
                        <button className="btn btn-ghost py-1.5 px-3 text-xs" onClick={() => setOpenKey(openKey === it.key ? null : it.key)}>+ Remind me</button>
                        {openKey === it.key && (
                          <div className="absolute right-0 top-full mt-1 z-20 card p-1.5 w-64 shadow-[var(--shadow-pop)]">
                            {QUICK.map(qk => <button key={qk.label} className="w-full text-left rounded-md px-3 py-1.5 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink" onClick={() => addReminder(it, qk.ms)}>{qk.label}</button>)}
                            <div className="my-1 border-t border-line" />
                            <div className="px-2 py-1.5">
                              <div className="eyebrow mb-1">Custom</div>
                              <input className="input text-xs" type="datetime-local" onChange={e => e.target.value && addCustom(it, e.target.value)} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

      {data && data.undated.length > 0 && (
        <section className="mb-7 rise">
          <div className="flex items-center gap-3 mb-3"><h2 className="display text-xl font-medium text-ink-2">No due date</h2><div className="h-px flex-1 bg-line" /></div>
          <div className="card divide-y divide-line">
            {data.undated.map(it => <div key={it.key} className="px-4 py-2.5 text-sm flex gap-3"><span className="mono text-[10px] uppercase tracking-widest text-ink-3 w-16">{it.course_code}</span><a href={it.html_url} target="_blank" rel="noreferrer" className="font-medium hover:text-signal">{it.name}</a></div>)}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status, score, points }: { status: UpcomingItem['status']; score: number | null; points: number | null }) {
  const map: Record<string, [string, string]> = {
    todo: ['To do', 'border-line text-ink-2'], submitted: ['Submitted', 'border-teal/40 text-teal bg-teal/5'],
    graded: [`Graded${score != null ? ` ${score}${points != null ? `/${points}` : ''}` : ''}`, 'border-moss/40 text-moss bg-moss/5'],
    missing: ['Missing', 'border-signal/50 text-signal bg-signal/5'], excused: ['Excused', 'border-line text-ink-3'],
  };
  const [label, cls] = map[status];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{label}</span>;
}

export function fmtWindow(mins: number) {
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${mins / 60} h`;
  if (mins < 10080) return `${mins / 1440} day${mins === 1440 ? '' : 's'}`;
  return `${mins / 10080} week${mins === 10080 ? '' : 's'}`;
}
