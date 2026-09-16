import { useEffect, useState } from 'react';
import { api, type Course } from '../api';
import { useApp, Spinner } from '../App';
import { PageHeader } from '../components/Shell';

export default function Courses() {
  const { toast } = useApp();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const load = async () => setCourses(await api.get<Course[]>('/courses'));
  useEffect(() => { void load(); }, []);

  const toggle = async (c: Course) => {
    setCourses(l => l?.map(x => x.canvas_id === c.canvas_id ? { ...x, muted: !x.muted } : x) ?? null);
    await api.patch(`/courses/${c.canvas_id}`, { muted: !c.muted });
    toast(!c.muted ? `${c.course_code} muted — no alerts, still tracked` : `${c.course_code} unmuted`);
  };

  return (
    <div>
      <PageHeader eyebrow="Enrolled this term" title="Courses" />
      {!courses ? <div className="py-16 grid place-items-center"><Spinner /></div> : (
        <div className="grid sm:grid-cols-2 gap-4">
          {courses.map((c, i) => (
            <div key={c.canvas_id} className={`card p-5 rise ${c.muted ? 'opacity-60' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="eyebrow">{c.course_code}{c.term ? ` · ${c.term}` : ''}</div>
                  <a href={c.html_url} target="_blank" rel="noreferrer" className="display block text-2xl font-medium leading-tight mt-1 hover:text-signal">{c.name}</a>
                </div>
                <div className="text-right shrink-0">
                  <div className={`display text-4xl font-medium leading-none ${gradeTone(c.current_score)}`}>{c.current_grade ?? (c.current_score != null ? `${c.current_score}%` : '—')}</div>
                  {c.current_grade && c.current_score != null && <div className="mono text-[10px] text-ink-3 mt-1">{c.current_score}%</div>}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs text-ink-3">{c.muted ? 'Muted: tracked, but no alerts.' : 'Alerts on for this course.'}</span>
                <button className="switch" data-on={!c.muted} onClick={() => toggle(c)} aria-label="toggle alerts" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function gradeTone(score: number | null) {
  if (score == null) return 'text-ink-3';
  if (score >= 90) return 'text-moss';
  if (score >= 80) return 'text-ink';
  if (score >= 70) return 'text-gold';
  return 'text-signal';
}
