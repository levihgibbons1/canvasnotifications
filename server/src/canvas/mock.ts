/**
 * Demo Canvas: a small simulated institution that behaves like the Canvas API
 * and can be nudged forward in time ("simulate activity") so the whole
 * notification pipeline can be exercised without a real Canvas developer key.
 */
import { kv } from '../db.js';
import type {
  CanvasSource, CanvasProfile, CanvasCourse, CanvasAssignment, CanvasAnnouncement,
  CanvasConversation, CanvasDiscussion, CanvasSubmissionComment,
} from './types.js';

const BASE = 'https://canvas.demo.edu';
const H = 3_600_000, D = 24 * H;

interface World {
  seq: number;
  profile: CanvasProfile;
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  announcements: CanvasAnnouncement[];
  conversations: CanvasConversation[];
  discussions: CanvasDiscussion[];
  log: string[];
}

const iso = (t: number) => new Date(t).toISOString();

function seed(name: string): World {
  const now = Date.now();
  const courses: CanvasCourse[] = [
    { id: '101', name: 'Molecular Biology', course_code: 'BIO 301', term: 'Fall 2026', current_score: 91.4, current_grade: 'A-', html_url: `${BASE}/courses/101` },
    { id: '102', name: 'Data Structures & Algorithms', course_code: 'CS 240', term: 'Fall 2026', current_score: 84.2, current_grade: 'B', html_url: `${BASE}/courses/102` },
    { id: '103', name: 'Intro to Macroeconomics', course_code: 'ECON 102', term: 'Fall 2026', current_score: 77.8, current_grade: 'C+', html_url: `${BASE}/courses/103` },
    { id: '104', name: 'Contemporary Fiction', course_code: 'ENGL 215', term: 'Fall 2026', current_score: 95.0, current_grade: 'A', html_url: `${BASE}/courses/104` },
  ];
  let id = 5000;
  const A = (course: string, name: string, dueIn: number | null, pts: number, s: Partial<CanvasAssignment['submission']> = {}, types = ['online_upload']): CanvasAssignment => {
    const aid = String(id++);
    return {
      id: aid, course_id: course, name, due_at: dueIn === null ? null : iso(now + dueIn), points_possible: pts,
      html_url: `${BASE}/courses/${course}/assignments/${aid}`, published: true, submission_types: types,
      submission: { workflow_state: 'unsubmitted', score: null, grade: null, graded_at: null, posted_at: null, submitted_at: null, late: false, missing: false, excused: false, comments: [], ...s },
    };
  };
  const graded = (score: number, agoH: number, comments: CanvasSubmissionComment[] = []): Partial<CanvasAssignment['submission']> => ({
    workflow_state: 'graded', score, grade: String(score), graded_at: iso(now - agoH * H), posted_at: iso(now - agoH * H), submitted_at: iso(now - (agoH + 30) * H), comments,
  });
  const assignments: CanvasAssignment[] = [
    A('101', 'Lab 4: PCR amplification report', 2 * D + 3 * H, 50),
    A('101', 'Problem Set 6: Gene regulation', 6 * D, 30),
    A('101', 'Midterm exam', 12 * D, 100, {}, ['on_paper']),
    A('101', 'Lab 3: Gel electrophoresis', -5 * D, 50, graded(46, 20, [{ id: 'c1', author_name: 'Dr. Okafor', comment: 'Excellent controls. Label your ladder lanes next time.', created_at: iso(now - 20 * H) }])),
    A('102', 'Project 2: Balanced BST', 22 * H, 100, {}, ['online_upload']),
    A('102', 'Homework 7: Hash tables', 4 * D + 5 * H, 20),
    A('102', 'Quiz 5: Graph traversal', 8 * D, 15, {}, ['online_quiz']),
    A('102', 'Homework 6: Heaps', -3 * D, 20, graded(17, 60)),
    A('102', 'Project 1: Linked lists', -14 * D, 100, graded(88, 200)),
    A('103', 'Reading response: Fiscal policy', -1 * D, 10, { missing: true }),
    A('103', 'Problem Set 4', 3 * D + 6 * H, 25),
    A('103', 'Essay: Inflation targeting', 9 * D, 60),
    A('103', 'Problem Set 3', -6 * D, 25, graded(19, 100)),
    A('104', 'Discussion post: Never Let Me Go', 1 * D + 2 * H, 10, {}, ['discussion_topic']),
    A('104', 'Close reading essay #2', 7 * D + 2 * H, 40),
    A('104', 'Close reading essay #1', -10 * D, 40, graded(38, 120, [{ id: 'c2', author_name: 'Prof. Delacroix', comment: 'A sharp thesis. Push harder on the ending.', created_at: iso(now - 120 * H) }])),
  ];
  const announcements: CanvasAnnouncement[] = [
    { id: '9001', course_id: '102', title: 'Project 2 autograder is live', message: '<p>The autograder for Project 2 is now accepting submissions. You get unlimited attempts before the deadline.</p>', posted_at: iso(now - 26 * H), author_name: 'Prof. Nakamura', html_url: `${BASE}/courses/102/discussion_topics/9001` },
    { id: '9002', course_id: '101', title: 'Office hours moved to Thursday', message: '<p>This week only, office hours will be Thursday 2–4pm in Life Sciences 210.</p>', posted_at: iso(now - 50 * H), author_name: 'Dr. Okafor', html_url: `${BASE}/courses/101/discussion_topics/9002` },
    { id: '9003', course_id: '103', title: 'Midterm grades posted', message: '<p>Midterm grades are up. Come see me if you scored under 70.</p>', posted_at: iso(now - 4 * D), author_name: 'Dr. Haddad', html_url: `${BASE}/courses/103/discussion_topics/9003` },
  ];
  const conversations: CanvasConversation[] = [
    { id: '7001', subject: 'Re: extension request', last_message: 'Sure, you can have until Friday. Please upload by 5pm.', last_message_at: iso(now - 3 * H), last_author_name: 'Dr. Haddad', workflow_state: 'unread', message_count: 3, html_url: `${BASE}/conversations/7001`, course_id: '103' },
    { id: '7002', subject: 'Study group for midterm', last_message: 'We are meeting in the library, room 3B, Tuesday at 6.', last_message_at: iso(now - 2 * D), last_author_name: 'Maya Chen', workflow_state: 'read', message_count: 8, html_url: `${BASE}/conversations/7002`, course_id: '101' },
  ];
  const discussions: CanvasDiscussion[] = [
    { id: '8001', course_id: '104', title: 'Week 5: Unreliable narrators', unread_count: 2, last_reply_at: iso(now - 5 * H), html_url: `${BASE}/courses/104/discussion_topics/8001` },
    { id: '8002', course_id: '102', title: 'Q&A: Project 2', unread_count: 0, last_reply_at: iso(now - 30 * H), html_url: `${BASE}/courses/102/discussion_topics/8002` },
  ];
  return {
    seq: id,
    profile: { id: 'demo-1', name, primary_email: 'student@canvas.demo.edu', avatar_url: undefined },
    courses, assignments, announcements, conversations, discussions, log: [],
  };
}

const worlds = new Map<string, World>();
const key = (userKey: string) => `mockworld:${userKey}`;

export async function loadWorld(userKey: string, name = 'Demo Student'): Promise<World> {
  let w = worlds.get(userKey);
  if (w) return w;
  const stored = await kv.get(key(userKey));
  w = stored ? (JSON.parse(stored) as World) : seed(name);
  worlds.set(userKey, w);
  if (!stored) await saveWorld(userKey);
  return w;
}
async function saveWorld(userKey: string) {
  const w = worlds.get(userKey);
  if (w) await kv.set(key(userKey), JSON.stringify(w));
}
export async function resetWorld(userKey: string, name: string) {
  worlds.delete(userKey);
  await kv.del(key(userKey));
  return loadWorld(userKey, name);
}

/** Advance the simulated institution: an instructor grades, comments, posts, etc. */
export async function simulateActivity(userKey: string, kind?: string): Promise<string> {
  const w = await loadWorld(userKey);
  const now = Date.now();
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const kinds = ['grade', 'comment', 'announcement', 'assignment', 'message', 'discussion', 'due_change', 'regrade'];
  const k = kind && kinds.includes(kind) ? kind : pick(kinds);
  const course = pick(w.courses);
  let msg = '';
  switch (k) {
    case 'grade': {
      const cands = w.assignments.filter(a => a.submission.workflow_state !== 'graded' && a.due_at && new Date(a.due_at).getTime() < now + 2 * 86400000);
      const a = cands.length ? pick(cands) : pick(w.assignments);
      const pts = a.points_possible ?? 10;
      const score = Math.round(pts * (0.7 + Math.random() * 0.3) * 2) / 2;
      a.submission = { ...a.submission, workflow_state: 'graded', score, grade: String(score), graded_at: iso(now), posted_at: iso(now), submitted_at: a.submission.submitted_at ?? iso(now - 3 * H), missing: false };
      const c = w.courses.find(c => c.id === a.course_id)!;
      c.current_score = Math.round(((c.current_score ?? 85) * 0.9 + (score / pts) * 100 * 0.1) * 10) / 10;
      msg = `Graded "${a.name}" (${score}/${pts})`;
      break;
    }
    case 'regrade': {
      const cands = w.assignments.filter(a => a.submission.workflow_state === 'graded');
      const a = pick(cands);
      const pts = a.points_possible ?? 10;
      const score = Math.min(pts, (a.submission.score ?? 0) + 1.5);
      a.submission = { ...a.submission, score, grade: String(score), graded_at: iso(now) };
      msg = `Regraded "${a.name}" to ${score}/${pts}`;
      break;
    }
    case 'comment': {
      const cands = w.assignments.filter(a => a.submission.submitted_at);
      const a = pick(cands);
      const texts = ['Nice work overall — see my inline notes.', 'Please resubmit with the missing section.', 'Great improvement from last time!', 'Your citations need page numbers.', 'Can you stop by office hours to discuss this?'];
      a.submission.comments.push({ id: `c${w.seq++}`, author_name: pick(['Dr. Okafor', 'Prof. Nakamura', 'Dr. Haddad', 'Prof. Delacroix', 'TA Jordan Reyes']), comment: pick(texts), created_at: iso(now) });
      msg = `New comment on "${a.name}"`;
      break;
    }
    case 'announcement': {
      const titles = ['Class cancelled tomorrow', 'Exam room change', 'Extra credit opportunity', 'Reminder: reading due Monday', 'Guest lecture on Friday'];
      const t = pick(titles);
      w.announcements.unshift({ id: String(w.seq++), course_id: course.id, title: t, message: `<p>${t}. Check the syllabus page for details and reply on the discussion board with questions.</p>`, posted_at: iso(now), author_name: 'Instructor', html_url: `${course.html_url}/discussion_topics/${w.seq}` });
      msg = `Announcement in ${course.course_code}: ${t}`;
      break;
    }
    case 'assignment': {
      const names = ['Pop quiz makeup', 'Reflection journal #3', 'Peer review: draft 2', 'Problem Set 8', 'Lab 5 pre-work'];
      const n = pick(names);
      const id = String(w.seq++);
      w.assignments.push({ id, course_id: course.id, name: n, due_at: iso(now + (2 + Math.floor(Math.random() * 6)) * D), points_possible: 20, html_url: `${course.html_url}/assignments/${id}`, published: true, submission_types: ['online_text_entry'], submission: { workflow_state: 'unsubmitted', score: null, grade: null, graded_at: null, posted_at: null, submitted_at: null, late: false, missing: false, excused: false, comments: [] } });
      msg = `New assignment in ${course.course_code}: ${n}`;
      break;
    }
    case 'due_change': {
      const cands = w.assignments.filter(a => a.due_at && new Date(a.due_at).getTime() > now);
      const a = pick(cands);
      a.due_at = iso(new Date(a.due_at!).getTime() + 2 * D);
      msg = `Due date extended for "${a.name}"`;
      break;
    }
    case 'message': {
      const subj = pick(['Question about your submission', 'Re: study group', 'Grade dispute follow-up', 'Missing work']);
      w.conversations.unshift({ id: String(w.seq++), subject: subj, last_message: pick(['Can you resend the file? It came through corrupted.', 'Just checking in — you missed the last two lectures.', 'Confirmed, the regrade is posted.', 'Meet at 4 in the lab?']), last_message_at: iso(now), last_author_name: pick(['Dr. Okafor', 'Maya Chen', 'TA Jordan Reyes']), workflow_state: 'unread', message_count: 1, html_url: `${BASE}/conversations/${w.seq}`, course_id: course.id });
      msg = `New Canvas message: ${subj}`;
      break;
    }
    case 'discussion': {
      const d = pick(w.discussions);
      d.unread_count += 1 + Math.floor(Math.random() * 3);
      d.last_reply_at = iso(now);
      msg = `New replies in "${d.title}"`;
      break;
    }
  }
  w.log.unshift(`${new Date(now).toLocaleTimeString()} — ${msg}`);
  w.log = w.log.slice(0, 50);
  await saveWorld(userKey);
  return msg;
}

export class MockCanvas implements CanvasSource {
  constructor(private userKey: string, private name = 'Demo Student') {}
  private w() { return loadWorld(this.userKey, this.name); }
  async profile() { return (await this.w()).profile; }
  async courses() { return (await this.w()).courses; }
  async assignments(courseId: string) { return (await this.w()).assignments.filter(a => a.course_id === courseId); }
  async announcements(courseIds: string[], sinceIso: string) {
    return (await this.w()).announcements.filter(a => courseIds.includes(a.course_id) && a.posted_at >= sinceIso);
  }
  async conversations() { return (await this.w()).conversations; }
  async discussions(courseId: string) { return (await this.w()).discussions.filter(d => d.course_id === courseId); }
}
