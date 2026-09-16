import { useCallback, useEffect, useState } from 'react';
import { api, CATEGORY_STYLE, relTime, type Delivery } from '../api';
import { useApp, Empty, Spinner } from '../App';
import { PageHeader } from '../components/Shell';

const STATUS: Record<string, [string, string]> = {
  sent: ['Sent', 'border-moss/40 text-moss bg-moss/5'],
  simulated: ['Simulated', 'border-navy/40 text-navy bg-navy/5'],
  queued: ['Held · quiet hours', 'border-gold/40 text-gold bg-gold/5'],
  digest: ['Waiting for digest', 'border-line text-ink-2'],
  digested: ['In digest', 'border-line text-ink-3'],
  failed: ['Failed', 'border-signal/50 text-signal bg-signal/5'],
  skipped: ['Skipped', 'border-line text-ink-3'],
};
const CH: Record<string, string> = { push: '🔔', email: '✉️', sms: '💬' };

export default function Outbox() {
  const { me, toast } = useApp();
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>('');
  const load = useCallback(async () => setRows(await api.get<Delivery[]>('/deliveries')), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); const h = () => void load(); window.addEventListener('dispatch:refresh', h); return () => { clearInterval(t); window.removeEventListener('dispatch:refresh', h); }; }, [load]);

  const digestNow = async () => { await api.post('/deliveries/digest-now', { channel: 'email' }); await load(); toast('Digest generated'); };
  const caps = me!.capabilities;
  const visible = (rows ?? []).filter(r => !filter || r.channel === filter);

  return (
    <div>
      <PageHeader eyebrow="Every push, email and text" title="Outbox">
        <button className="btn btn-ghost" onClick={digestNow}>Generate today's digest now</button>
      </PageHeader>

      <div className="card p-4 mb-6 text-sm text-ink-2 rise">
        <span className="font-semibold text-ink">What you're looking at.</span> Each row is one message Dispatch decided to send, based on your preferences.
        {' '}{caps.smtp ? 'Emails are delivered over SMTP.' : <>Emails are <em>simulated</em> (no SMTP configured) so you can read exactly what would have been sent.</>}
        {' '}{caps.sms ? 'Texts go out through Twilio.' : <>Texts are <em>simulated</em> (no Twilio configured).</>}
        {' '}Push notifications are real once you enable them in Settings. Add an email or phone number there to see deliveries appear here.
      </div>

      <div className="flex gap-2 mb-4 rise">
        {['', 'push', 'email', 'sms'].map(f => <button key={f} className="chip" data-on={filter === f} onClick={() => setFilter(f)}>{f ? `${CH[f]} ${f}` : 'All'}</button>)}
      </div>

      {!rows ? <div className="py-16 grid place-items-center"><Spinner /></div>
        : visible.length === 0 ? <Empty title="Nothing sent yet.">Add an email address or phone number in Settings, or enable push. Then trigger some activity.</Empty>
        : (
          <div className="card divide-y divide-line rise">
            {visible.map(d => {
              const [label, cls] = STATUS[d.status] ?? [d.status, 'border-line'];
              const st = d.category ? CATEGORY_STYLE[d.category] : null;
              return (
                <div key={d.id} className="px-4 py-3">
                  <button className="w-full text-left flex items-start gap-3" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <span className="text-lg leading-none mt-0.5">{CH[d.channel]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{label}</span>
                        {st && <span className="mono text-[10px] uppercase tracking-widest" style={{ color: st.color }}>{st.label}</span>}
                        <span className="mono text-[10px] text-ink-3 truncate">→ {d.channel === 'push' ? 'this browser' : d.address}</span>
                        <span className="ml-auto mono text-[10px] text-ink-3">{relTime(d.sent_at ?? d.created_at)}{d.status === 'queued' && d.send_after ? ` · sends ${new Date(d.send_after).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                      </div>
                      <div className="mt-1 font-medium text-[15px] truncate">{d.subject}</div>
                      {d.error && <div className="text-xs text-signal mt-0.5">{d.error}</div>}
                    </div>
                  </button>
                  {open === d.id && (
                    <div className="mt-3 ml-8 rounded-lg border border-line bg-paper-2/60 p-4">
                      {d.channel === 'sms' ? (
                        <div className="max-w-xs ml-auto rounded-2xl rounded-br-sm bg-ink text-paper px-4 py-2.5 text-sm whitespace-pre-line">{d.body}</div>
                      ) : (
                        <>
                          <div className="mono text-[10px] text-ink-3 mb-2">{d.channel === 'email' ? `To: ${d.address}\nSubject: ${d.subject}` : `Push · ${d.subject}`}</div>
                          <pre className="whitespace-pre-wrap font-sans text-sm text-ink-2 leading-relaxed">{d.body}</pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
