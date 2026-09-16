import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, CATEGORY_STYLE, dayLabel, timeOf, relTime, type Notification, type Category, type Stats, type Course } from '../api';
import { useApp, Empty, Spinner } from '../App';
import { PageHeader } from '../components/Shell';

export default function Feed() {
  const { me, refresh, toast } = useApp();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [cat, setCat] = useState<Category | ''>('');
  const [course, setCourse] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    const [n, s, c] = await Promise.all([api.get<Notification[]>('/notifications'), api.get<Stats>('/stats'), api.get<Course[]>('/courses')]);
    setItems(n); setStats(s); setCourses(c);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20_000); const h = () => void load(); window.addEventListener('dispatch:refresh', h); return () => { clearInterval(t); window.removeEventListener('dispatch:refresh', h); }; }, [load]);
  // Reload as soon as a sync finishes.
  useEffect(() => { void load(); }, [load, me!.user.last_sync_at]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of items ?? []) m.set(n.category, (m.get(n.category) ?? 0) + 1);
    return m;
  }, [items]);

  const visible = useMemo(() => (items ?? []).filter(n => (!cat || n.category === cat) && (!course || n.course_id === course) && (!unreadOnly || !n.is_read)), [items, cat, course, unreadOnly]);
  const groups = useMemo(() => {
    const g: { label: string; items: Notification[] }[] = [];
    for (const n of visible) {
      const label = dayLabel(n.created_at);
      const last = g[g.length - 1];
      if (last && last.label === label) last.items.push(n); else g.push({ label, items: [n] });
    }
    return g;
  }, [visible]);

  const markRead = async (ids: number[], read = true) => {
    setItems(list => list?.map(n => ids.includes(n.id) ? { ...n, is_read: read } : n) ?? null);
    await api.post('/notifications/read', { ids, read });
    void refresh(); void load();
  };
  const markAll = async () => { await api.post('/notifications/read', { all: true }); await load(); await refresh(); toast('All caught up'); };
  const remove = async (id: number) => { setItems(l => l?.filter(n => n.id !== id) ?? null); await api.del(`/notifications/${id}`); void refresh(); };

  const catList = me!.categories.filter(c => c.id !== 'digest');

  return (
    <div>
      <PageHeader eyebrow={`${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`} title={greeting(me!.user.name)}>
        {me!.unread > 0 && <button className="btn btn-ghost" onClick={markAll}>Mark all read</button>}
      </PageHeader>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Stat n={stats.dueWeek} label="due this week" tone="signal" delay={0} />
          <Stat n={stats.missing} label="missing" tone={stats.missing ? 'signal' : 'ink'} delay={60} />
          <Stat n={stats.gradesWeek} label="grade updates · 7d" tone="moss" delay={120} />
          <Stat n={stats.unread} label="unread here" tone="ink" delay={180} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5 rise" style={{ animationDelay: '200ms' }}>
        <button className="chip" data-on={cat === ''} onClick={() => setCat('')}>All <span className="mono text-[10px] opacity-70">{items?.length ?? 0}</span></button>
        {catList.map(c => {
          const n = counts.get(c.id) ?? 0;
          if (!n) return null;
          return <button key={c.id} className="chip" data-on={cat === c.id} onClick={() => setCat(cat === c.id ? '' : c.id)}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: CATEGORY_STYLE[c.id].color }} />{c.label} <span className="mono text-[10px] opacity-70">{n}</span>
          </button>;
        })}
        <div className="ml-auto flex items-center gap-2">
          <select className="input py-1.5 w-auto text-xs" value={course} onChange={e => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map(c => <option key={c.canvas_id} value={c.canvas_id}>{c.course_code} · {c.name}</option>)}
          </select>
          <button className="chip" data-on={unreadOnly} onClick={() => setUnreadOnly(u => !u)}>Unread only</button>
        </div>
      </div>

      {!items ? <div className="py-16 grid place-items-center"><Spinner /></div>
        : visible.length === 0 ? (
          items.length ? <Empty title="Nothing matches those filters.">Try clearing a filter.</Empty>
          : me!.syncing ? <Empty title="Importing from Canvas…">Your recent grades, comments, announcements and messages will appear here in a moment.</Empty>
          : me!.user.last_sync_error ? <Empty title="Nothing here yet because the sync failed.">Use the banner above to retry, or open Settings → Canvas connection to see what went wrong.</Empty>
          : me!.user.auth_mode === 'demo' ? <Empty title="Your feed is empty.">Press "Simulate Canvas activity" in the sidebar to make something happen.</Empty>
          : <Empty title="All quiet.">Nothing has changed in your courses in the last two weeks. New grades, comments, announcements and messages will show up here as they happen.</Empty>
        )
        : groups.map((g, gi) => (
          <section key={g.label} className="mb-7 rise" style={{ animationDelay: `${240 + gi * 40}ms` }}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="display text-xl font-medium">{g.label}</h2>
              <div className="h-px flex-1 bg-line" />
              <span className="mono text-[10px] text-ink-3">{g.items.length}</span>
            </div>
            <div className="space-y-2">
              {g.items.map(n => <Card key={n.id} n={n} onRead={() => markRead([n.id], !n.is_read)} onRemove={() => remove(n.id)} />)}
            </div>
          </section>
        ))}
    </div>
  );
}

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${g}, ${name.split(' ')[0]}.`;
}

function Stat({ n, label, tone, delay }: { n: number; label: string; tone: 'signal' | 'moss' | 'ink'; delay: number }) {
  const color = tone === 'signal' ? 'text-signal' : tone === 'moss' ? 'text-moss' : 'text-ink';
  return (
    <div className="card px-5 py-4 rise" style={{ animationDelay: `${delay}ms` }}>
      <div className={`display text-4xl font-medium leading-none ${color}`}>{n}</div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  );
}

function Card({ n, onRead, onRemove }: { n: Notification; onRead: () => void; onRemove: () => void }) {
  const st = CATEGORY_STYLE[n.category];
  const [open, setOpen] = useState(false);
  const long = n.body.length > 140;
  return (
    <article className={`card relative pl-5 pr-4 py-3.5 transition-colors ${n.is_read ? 'opacity-75' : ''}`}>
      <span className="cat-bar" style={{ background: st.color }} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono text-[10px] uppercase tracking-[0.14em]" style={{ color: st.color }}>{st.glyph} {st.label}</span>
            {n.course_name && <span className="text-[11px] text-ink-3 truncate">· {n.course_name}</span>}
            <span className="ml-auto mono text-[10px] text-ink-3" title={new Date(n.created_at).toLocaleString()}>{timeOf(n.created_at)} · {relTime(n.created_at)}</span>
          </div>
          <div className={`mt-1 text-[15px] leading-snug ${n.is_read ? 'font-medium text-ink-2' : 'font-semibold text-ink'}`}>{n.title}</div>
          {n.body && <p className={`mt-1 text-sm text-ink-2 leading-relaxed whitespace-pre-line ${!open && long ? 'line-clamp-2' : ''}`}>{n.body}</p>}
          {long && <button className="mt-1 mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink" onClick={() => setOpen(o => !o)}>{open ? 'less' : 'more'}</button>}
          <div className="mt-2 flex items-center gap-3 text-xs">
            {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="font-medium text-navy hover:text-signal">Open in Canvas ↗</a>}
            <button className="text-ink-3 hover:text-ink" onClick={onRead}>{n.is_read ? 'Mark unread' : 'Mark read'}</button>
            <button className="text-ink-3 hover:text-signal" onClick={onRemove}>Dismiss</button>
          </div>
        </div>
        {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal" />}
      </div>
    </article>
  );
}
