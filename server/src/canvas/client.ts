import type {
  CanvasSource, CanvasProfile, CanvasCourse, CanvasAssignment, CanvasAnnouncement,
  CanvasConversation, CanvasDiscussion, CanvasSubmission,
} from './types.js';

export class CanvasApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Thin, paginating client for the Canvas LMS REST API (https://canvas.instructure.com/doc/api/). */
export class CanvasClient implements CanvasSource {
  private baseUrl: string;
  constructor(baseUrl: string, private token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, params: Record<string, any> = {}): Promise<{ data: T; next?: string }> {
    const url = path.startsWith('http') ? new URL(path) : new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CanvasApiError(res.status, `Canvas ${res.status} on ${url.pathname}: ${text.slice(0, 200)}`);
    }
    const link = res.headers.get('link') ?? '';
    const next = link.split(',').map(s => s.trim()).find(s => s.endsWith('rel="next"'))?.match(/<([^>]+)>/)?.[1];
    return { data: (await res.json()) as T, next };
  }

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    return (await this.request<T>(path, params)).data;
  }

  /** Follows Link: rel="next" headers until exhausted (capped for safety). */
  async getAll<T>(path: string, params: Record<string, any> = {}, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let { data, next } = await this.request<T[]>(path, { per_page: 100, ...params });
    out.push(...data);
    let pages = 1;
    while (next && pages < maxPages) {
      ({ data, next } = await this.request<T[]>(next));
      out.push(...data);
      pages++;
    }
    return out;
  }

  async profile(): Promise<CanvasProfile> {
    const p = await this.get<any>('/users/self/profile');
    return { id: String(p.id), name: p.name, primary_email: p.primary_email, avatar_url: p.avatar_url };
  }

  async courses(): Promise<CanvasCourse[]> {
    const rows = await this.getAll<any>('/courses', {
      enrollment_state: 'active',
      'include[]': ['total_scores', 'term'],
      'state[]': ['available'],
    });
    return rows.filter(c => c.name && !c.access_restricted_by_date).map(c => {
      const enr = (c.enrollments ?? []).find((e: any) => e.type === 'student') ?? c.enrollments?.[0];
      return {
        id: String(c.id), name: c.name, course_code: c.course_code ?? '',
        term: c.term?.name,
        current_score: enr?.computed_current_score ?? null,
        current_grade: enr?.computed_current_grade ?? null,
        html_url: `${this.baseUrl}/courses/${c.id}`,
      };
    });
  }

  async assignments(courseId: string): Promise<CanvasAssignment[]> {
    // One call gives every assignment plus the current user's own submission.
    const rows = await this.getAll<any>(`/courses/${courseId}/assignments`, {
      'include[]': ['submission'], order_by: 'due_at',
    });
    // Submission comments require the submissions endpoint; best-effort.
    let commentsByAssignment = new Map<string, any[]>();
    try {
      const subs = await this.getAll<any>(`/courses/${courseId}/students/submissions`, {
        'student_ids[]': ['self'], 'include[]': ['submission_comments'],
      });
      commentsByAssignment = new Map(subs.map(s => [String(s.assignment_id), s.submission_comments ?? []]));
    } catch { /* ignore */ }

    return rows.map(a => {
      const s = a.submission ?? {};
      const submission: CanvasSubmission = {
        workflow_state: s.workflow_state ?? 'unsubmitted',
        score: s.score ?? null, grade: s.grade ?? null,
        graded_at: s.graded_at ?? null, posted_at: s.posted_at ?? null, submitted_at: s.submitted_at ?? null,
        late: Boolean(s.late), missing: Boolean(s.missing), excused: Boolean(s.excused),
        comments: (commentsByAssignment.get(String(a.id)) ?? []).map((c: any) => ({
          id: String(c.id), author_name: c.author_name ?? 'Instructor', comment: c.comment ?? '', created_at: c.created_at,
        })),
      };
      return {
        id: String(a.id), course_id: courseId, name: a.name, due_at: a.due_at ?? null,
        points_possible: a.points_possible ?? null, html_url: a.html_url, published: a.published !== false,
        submission_types: a.submission_types ?? [], submission,
      };
    });
  }

  async announcements(courseIds: string[], sinceIso: string): Promise<CanvasAnnouncement[]> {
    const out: CanvasAnnouncement[] = [];
    for (let i = 0; i < courseIds.length; i += 10) {
      const chunk = courseIds.slice(i, i + 10);
      const rows = await this.getAll<any>('/announcements', {
        'context_codes[]': chunk.map(id => `course_${id}`), start_date: sinceIso, active_only: true,
      });
      for (const r of rows) out.push({
        id: String(r.id), course_id: String(r.context_code ?? '').replace('course_', ''),
        title: r.title, message: r.message ?? '', posted_at: r.posted_at,
        author_name: r.author?.display_name ?? r.user_name ?? 'Instructor', html_url: r.html_url,
      });
    }
    return out;
  }

  async conversations(): Promise<CanvasConversation[]> {
    const rows = await this.getAll<any>('/conversations', { per_page: 50 }, 2);
    return rows.map(c => {
      const lastAuthor = c.participants?.find((p: any) => c.audience?.includes(p.id))?.name ?? c.participants?.[0]?.name ?? 'Someone';
      return {
        id: String(c.id), subject: c.subject || '(no subject)', last_message: c.last_message ?? '',
        last_message_at: c.last_message_at, last_author_name: lastAuthor,
        workflow_state: c.workflow_state, message_count: c.message_count ?? 0,
        html_url: `${this.baseUrl}/conversations/${c.id}`,
        course_id: typeof c.context_code === 'string' && c.context_code.startsWith('course_') ? c.context_code.replace('course_', '') : undefined,
      };
    });
  }

  async discussions(courseId: string): Promise<CanvasDiscussion[]> {
    const rows = await this.getAll<any>(`/courses/${courseId}/discussion_topics`, { order_by: 'recent_activity' }, 2);
    return rows.map(d => ({
      id: String(d.id), course_id: courseId, title: d.title, unread_count: d.unread_count ?? 0,
      last_reply_at: d.last_reply_at ?? null, html_url: d.html_url,
    }));
  }
}
