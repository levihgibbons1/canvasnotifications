import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type CategoryDef, type Channel, type Frequency, type Settings as S } from '../api';
import { useApp, Spinner } from '../App';
import { PageHeader } from '../components/Shell';
import { fmtWindow } from './Upcoming';

const CHANNELS: { id: Channel; label: string }[] = [{ id: 'push', label: 'Push' }, { id: 'email', label: 'Email' }, { id: 'sms', label: 'Text' }];
const FREQ: { id: Frequency; label: string }[] = [{ id: 'immediately', label: 'Now' }, { id: 'daily', label: 'Digest' }, { id: 'never', label: 'Off' }];
const WINDOW_OPTIONS = [15, 60, 180, 360, 720, 1440, 2880, 4320, 10080];

interface ChannelsData { channels: { id: number; type: Channel; address: string; verified: number }[]; push: { id: number; endpoint: string }[] }

export default function Settings() {
  const { me, refresh, toast } = useApp();
  const [s, setS] = useState<S>(me!.settings);
  const [saved, setSaved] = useState(true);
  const [ch, setCh] = useState<ChannelsData | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pushState, setPushState] = useState<'unsupported' | 'off' | 'on' | 'busy' | 'denied'>('off');

  const loadCh = async () => setCh(await api.get<ChannelsData>('/channels'));
  useEffect(() => { void loadCh(); void detectPush().then(setPushState); }, []);

  const update = (patch: Partial<S>) => { setS(prev => ({ ...prev, ...patch })); setSaved(false); };
  const setPref = (cat: string, channel: Channel, f: Frequency) => update({ prefs: { ...s.prefs, [cat]: { ...(s.prefs[cat] ?? {}), [channel]: f } } });
  const save = async () => { await api.put('/settings', s); setSaved(true); await refresh(); toast('Settings saved'); };

  const addChannel = async (type: Channel, address: string) => {
    try { await api.post('/channels', { type, address }); type === 'email' ? setEmail('') : setPhone(''); await loadCh(); toast(`${type === 'email' ? 'Email' : 'Phone'} added`); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const removeChannel = async (id: number) => { await api.del(`/channels/${id}`); await loadCh(); };

  const enablePush = async () => {
    setPushState('busy');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPushState('denied'); return; }
      const { publicKey } = await api.get<{ publicKey: string }>('/push/vapid');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api.post('/push/subscribe', { subscription: sub.toJSON() });
      setPushState('on'); await loadCh(); toast('Browser notifications on');
    } catch (e: any) { toast(e.message, 'err'); setPushState('off'); }
  };
  const disablePush = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    setPushState('off'); await loadCh();
  };

  const groups = useMemo(() => {
    const g = new Map<string, CategoryDef[]>();
    for (const c of me!.categories) g.set(c.group, [...(g.get(c.group) ?? []), c]);
    return [...g.entries()];
  }, [me]);

  const caps = me!.capabilities;

  return (
    <div>
      <PageHeader eyebrow="How Dispatch reaches you" title="Settings">
        <button className={`btn ${saved ? 'btn-ghost' : 'btn-signal'}`} onClick={save} disabled={saved}>{saved ? 'Saved' : 'Save changes'}</button>
      </PageHeader>

      {/* ---- Channels ---- */}
      <Section n="01" title="Where to send things" hint="Add as many as you like. Each category below can go to any mix of them.">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="flex items-center justify-between"><div className="font-semibold">Browser push</div><Badge on={pushState === 'on'} /></div>
            <p className="text-xs text-ink-3 mt-1 min-h-8">Instant notifications from this browser, even when the tab is closed.</p>
            {pushState === 'unsupported' ? <div className="text-xs text-signal mt-3">Not supported in this browser.</div>
              : pushState === 'denied' ? <div className="text-xs text-signal mt-3">Blocked. Allow notifications for this site in your browser settings.</div>
              : pushState === 'on' ? <button className="btn btn-ghost mt-3 w-full justify-center" onClick={disablePush}>Turn off on this device</button>
              : <button className="btn btn-primary mt-3 w-full justify-center" disabled={pushState === 'busy'} onClick={enablePush}>{pushState === 'busy' ? <Spinner /> : null} Enable on this device</button>}
            {ch && ch.push.length > 0 && <div className="mono text-[10px] text-ink-3 mt-2">{ch.push.length} device{ch.push.length === 1 ? '' : 's'} subscribed</div>}
          </div>

          <ChannelCard title="Email" hint={caps.smtp ? 'Sent via SMTP.' : 'No SMTP configured: emails are rendered to the Outbox instead.'} list={ch?.channels.filter(c => c.type === 'email') ?? []} onRemove={removeChannel}
            input={<input className="input" placeholder={me!.user.email ?? 'you@school.edu'} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addChannel('email', email)} />}
            onAdd={() => addChannel('email', email)} />
          <ChannelCard title="Text message" hint={caps.sms ? 'Sent via Twilio.' : 'No Twilio configured: texts are rendered to the Outbox instead.'} list={ch?.channels.filter(c => c.type === 'sms') ?? []} onRemove={removeChannel}
            input={<input className="input" placeholder="+1 555 123 4567" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && addChannel('sms', phone)} />}
            onAdd={() => addChannel('sms', phone)} />
        </div>
      </Section>

      {/* ---- Matrix ---- */}
      <Section n="02" title="What to send, and how fast" hint="Now = the moment it happens. Digest = bundled into one daily summary. Off = in-app only.">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left px-4 py-3 eyebrow font-normal">Category</th>
                {CHANNELS.map(c => <th key={c.id} className="px-3 py-3 eyebrow font-normal text-center">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, cats]) => (<Frag key={group}>
                <tr><td colSpan={4} className="px-4 pt-4 pb-1 display text-lg font-medium">{group}</td></tr>
                {cats.map(c => (
                  <tr key={c.id} className="border-t border-line/60">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-ink-3">{c.description}</div>
                    </td>
                    {CHANNELS.map(chn => (
                      <td key={chn.id} className="px-3 py-2.5 text-center">
                        <div className="seg">
                          {FREQ.filter(f => !(c.id === 'digest' && f.id === 'immediately')).map(f => (
                            <button key={f.id} data-on={(s.prefs[c.id]?.[chn.id] ?? c.defaults[chn.id]) === f.id} onClick={() => setPref(c.id, chn.id, f.id)}>{f.label}</button>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </Frag>))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---- Timing ---- */}
      <Section n="03" title="Timing" hint="Reminders fire for anything unsubmitted. Quiet hours hold immediate alerts until morning; digests go out at the time you pick.">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="font-semibold">Remind me before a due date</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {WINDOW_OPTIONS.map(w => <button key={w} className="chip" data-on={s.dueWindows.includes(w)} onClick={() => update({ dueWindows: s.dueWindows.includes(w) ? s.dueWindows.filter(x => x !== w) : [...s.dueWindows, w].sort((a, b) => a - b) })}>{fmtWindow(w)}</button>)}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div><div className="font-semibold text-sm">Missing-work alerts</div><div className="text-xs text-ink-3">When a due date passes with nothing turned in.</div></div>
              <button className="switch" data-on={s.missingAlerts} onClick={() => update({ missingAlerts: !s.missingAlerts })} />
            </div>
          </div>
          <div className="card p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div><div className="font-semibold text-sm">Daily digest at</div><div className="text-xs text-ink-3">Also lists everything due in the next 48 hours.</div></div>
              <input className="input w-auto" type="time" value={s.digestTime} onChange={e => update({ digestTime: e.target.value })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div><div className="font-semibold text-sm">Quiet hours</div><div className="text-xs text-ink-3">Hold push, email and texts overnight.</div></div>
              <button className="switch" data-on={s.quietHours.enabled} onClick={() => update({ quietHours: { ...s.quietHours, enabled: !s.quietHours.enabled } })} />
            </div>
            {s.quietHours.enabled && (
              <div className="flex items-center gap-2 text-sm">
                <input className="input w-auto" type="time" value={s.quietHours.start} onChange={e => update({ quietHours: { ...s.quietHours, start: e.target.value } })} />
                <span className="text-ink-3">to</span>
                <input className="input w-auto" type="time" value={s.quietHours.end} onChange={e => update({ quietHours: { ...s.quietHours, end: e.target.value } })} />
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="font-semibold text-sm">Time zone</div>
              <span className="mono text-xs text-ink-2">{s.timezone}</span>
            </div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end mt-2 mb-10">
        <button className={`btn ${saved ? 'btn-ghost' : 'btn-signal'}`} onClick={save} disabled={saved}>{saved ? 'Saved' : 'Save changes'}</button>
      </div>

      <ConnectionSection />
    </div>
  );
}

interface Diag { ok: boolean; ms: number; steps: { step: string; ok: boolean; detail: string }[]; base_url: string; auth_mode: string }

function ConnectionSection() {
  const { me, refresh, toast } = useApp();
  const nav = useNavigate();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [testing, setTesting] = useState(false);
  const u = me!.user;
  useEffect(() => { if (window.location.hash === '#connection') document.getElementById('connection')?.scrollIntoView({ behavior: 'smooth' }); }, []);

  const test = async () => { setTesting(true); try { setDiag(await api.get<Diag>('/diagnostics')); } catch (e: any) { toast(e.message, 'err'); } finally { setTesting(false); } };
  const resync = async () => { try { await api.post('/sync'); toast('Synced'); } catch (e: any) { toast(`Sync failed: ${e.message}`, 'err'); } await refresh(); };
  const logout = async () => { await api.auth('/logout'); await refresh(); nav('/login'); };

  const modeLabel = { demo: 'Demo (simulated Canvas)', token: 'Personal access token', oauth: 'Canvas OAuth sign-in' }[u.auth_mode];
  return (
    <div id="connection">
      <Section n="04" title="Canvas connection" hint="What Dispatch is connected to, whether it can talk to Canvas right now, and how to disconnect.">
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-4">
          <div className="card p-4 space-y-3 text-sm">
            <Row k="Canvas" v={u.canvas_base_url.replace(/^https?:\/\//, '')} />
            <Row k="Signed in as" v={u.name + (u.email ? ` · ${u.email}` : '')} />
            <Row k="Method" v={modeLabel} />
            <Row k="Courses tracked" v={String(me!.courseCount)} />
            <Row k="Last sync" v={u.last_sync_at ? new Date(u.last_sync_at).toLocaleString() : 'never'} />
            {u.last_sync_error && <div className="rounded-lg bg-signal/10 border border-signal/30 px-3 py-2 text-xs"><div className="font-semibold text-signal-deep">Last sync failed</div><div className="mono break-all text-ink-2 mt-0.5">{u.last_sync_error}</div></div>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn btn-primary" onClick={test} disabled={testing}>{testing ? <Spinner /> : null} Test connection</button>
              <button className="btn btn-ghost" onClick={resync} disabled={me!.syncing}>Sync now</button>
              <button className="btn btn-ghost hover:border-signal hover:text-signal ml-auto" onClick={logout}>Sign out</button>
            </div>
          </div>
          <div className="card p-4">
            <div className="eyebrow mb-2">Connection test</div>
            {!diag ? <p className="text-sm text-ink-3">Runs three live checks against Canvas: sign-in, course list, and reading one course's assignments. If a sync ever fails, this tells you exactly where.</p> : (
              <ul className="space-y-2">
                {diag.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full grid place-items-center text-[11px] font-bold ${s.ok ? 'bg-moss/10 text-moss' : 'bg-signal/10 text-signal'}`}>{s.ok ? '✓' : '✗'}</span>
                    <div className="min-w-0"><div className="font-medium">{s.step}</div><div className="text-xs text-ink-2 break-words">{s.detail}</div></div>
                  </li>
                ))}
                <li className="mono text-[10px] text-ink-3 pt-1">{diag.ok ? 'All good' : 'Something is wrong'} · {diag.ms} ms</li>
              </ul>
            )}
            {diag && !diag.ok && (
              <div className="mt-3 text-xs text-ink-2 rounded-lg bg-paper-2 p-3 space-y-1">
                <div className="font-semibold text-ink">Common fixes</div>
                <div>• <strong>401</strong>: the token was revoked or mistyped. Sign out and connect again with a fresh token.</div>
                <div>• <strong>No active courses</strong>: Canvas only returns courses whose term is current and that are published.</div>
                <div>• <strong>Network / ENOTFOUND</strong>: the Canvas address is wrong. Use the exact host from your browser bar.</div>
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-3"><span className="eyebrow w-28 shrink-0 pt-0.5">{k}</span><span className="min-w-0 break-words">{v}</span></div>;
}

const Frag = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function Section({ n, title, hint, children }: { n: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-9 rise">
      <div className="flex items-baseline gap-3 mb-1"><span className="mono text-[11px] text-signal">{n}</span><h2 className="display text-2xl font-medium">{title}</h2></div>
      <p className="text-sm text-ink-3 mb-4 max-w-2xl">{hint}</p>
      {children}
    </section>
  );
}

function Badge({ on }: { on: boolean }) {
  return <span className={`mono text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border ${on ? 'border-moss/40 text-moss bg-moss/5' : 'border-line text-ink-3'}`}>{on ? 'on' : 'off'}</span>;
}

function ChannelCard({ title, hint, list, input, onAdd, onRemove }: { title: string; hint: string; list: { id: number; address: string }[]; input: React.ReactNode; onAdd: () => void; onRemove: (id: number) => void }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between"><div className="font-semibold">{title}</div><Badge on={list.length > 0} /></div>
      <p className="text-xs text-ink-3 mt-1 min-h-8">{hint}</p>
      <div className="mt-3 flex gap-2">{input}<button className="btn btn-primary px-3" onClick={onAdd}>Add</button></div>
      {list.length > 0 && (
        <ul className="mt-3 space-y-1">
          {list.map(c => <li key={c.id} className="flex items-center justify-between text-sm"><span className="mono text-xs truncate">{c.address}</span><button className="text-xs text-ink-3 hover:text-signal" onClick={() => onRemove(c.id)}>remove</button></li>)}
        </ul>
      )}
    </div>
  );
}

async function detectPush(): Promise<'unsupported' | 'off' | 'on' | 'denied'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}
function urlBase64ToUint8Array(b64: string) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
