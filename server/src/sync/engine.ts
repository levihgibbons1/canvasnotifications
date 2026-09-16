/**
 * Sync engine: pulls the user's Canvas state, diffs it against the last snapshot,
 * and emits notifications for anything that changed. Also evaluates time-based
 * rules (due-soon reminders, missing work, custom reminders) from the snapshot.
 */
import { q, now } from '../db.js';
import { config } from '../config.js';
import { CanvasClient } from '../canvas/client.js';
import { MockCanvas } from '../canvas/mock.js';
import type { CanvasSource, CanvasAssignment, CanvasAnnouncement, CanvasConversation, CanvasDiscussion } from '../canvas/types.js';
import { createNotification, stripHtml } from '../notify/deliver.js';
import { getUser, getSettings, allUsers, type UserRow } from '../users.js';

const H = 3_600_000, D = 24 * H;
const running = new Set<number>();
export const isSyncing = (userId: number) => running.has(userId);

export async function getSource(user: UserRow): Promise<CanvasSource> {
  if (user.auth_mode === 'demo') return new MockCanvas(`u${user.id}`, user.name);
  let token = user.access_token ?? '';
  if (user.auth_mode === 'oauth' && user.refresh_token && user.token_expires_at && user.token_expires_at - now() < 5 * 60_000) {
    token = await refreshOAuthToken(user);
  }
  return new CanvasClient(user.canvas_base_url, token);
}

async function refreshOAuthToken(user: UserRow): Promise<string> {
  const res = await fetch(`${user.canvas_base_url}/login/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.canvasOAuth.clientId, client_secret: config.canvasOAuth.clientSecret, refresh_token: user.refresh_token! }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const j = await res.json() as { access_token: string; expires_in: number };
  await q.run('UPDATE users SET access_token = ?, token_expires_at = ? WHERE id = ?', j.access_token, now() + j.expires_in * 1000, user.id);
  return j.access_token;
}

// ---------- snapshot helpers ----------
async function loadSnapshot<T>(userId: number, kind: string): Promise<Map<string, T>> {
  return new Map((await q.all<{ key: string; data_json: string }>('SELECT key, data_json FROM snapshot WHERE user_id = ? AND kind = ?', userId, kind)).map(r => [r.key, JSON.parse(r.data_json) as T]));
}
async function putSnapshot(userId: number, kind: string, key: string, data: unknown) {
  await q.run(`INSERT INTO snapshot (user_id, kind, key, data_json, seen_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id, kind, key) DO UPDATE SET data_json = excluded.data_json, seen_at = excluded.seen_at`,
    userId, kind, key, JSON.stringify(data), now());
}
async function pruneSnapshot(userId: number, kind: string, keepKeys: Set<string>, prefix?: string) {
  const rows = await q.all<{ key: string }>('SELECT key FROM snapshot WHERE user_id = ? AND kind = ?', userId, kind);
  for (const r of rows) if (!keepKeys.has(r.key) && (!prefix || r.key.startsWith(prefix))) await q.run('DELETE FROM snapshot WHERE user_id = ? AND kind = ? AND key = ?', userId, kind, r.key);
}

const fmtScore = (a: CanvasAssignment) => `${a.submission.grade ?? a.submission.score}${a.points_possible != null ? ` / ${a.points_possible}` : ''}`;
const pct = (a: CanvasAssignment) => a.submission.score != null && a.points_possible ? ` (${Math.round((a.submission.score / a.points_possible) * 100)}%)` : '';

// ---------- main sync ----------
export async function syncUser(userId: number, opts: { initial?: boolean } = {}): Promise<{ created: number }> {
  if (running.has(userId)) return { created: 0 };
  running.add(userId);
  const user = await getUser(userId);
  if (!user) { running.delete(userId); return { created: 0 }; }
  const initial = opts.initial ?? user.last_sync_at == null;
  let created = 0;
  const emit: typeof createNotification = async (u, input) => { const n = await createNotification(u, input); if (n) created++; return n; };
  const t0 = now();
  try {
    const source = await getSource(user);
    const settings = getSettings(user);
    const courses = await source.courses();
    const muted = new Set((await q.all<{ canvas_id: string }>('SELECT canvas_id FROM courses WHERE user_id = ? AND muted = 1', userId)).map(r => r.canvas_id));
    const courseName = new Map(courses.map(c => [c.id, c.name]));
    for (const c of courses) {
      await q.run(`INSERT INTO courses (user_id, canvas_id, name, course_code, term, current_score, current_grade, html_url) VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(user_id, canvas_id) DO UPDATE SET name = excluded.name, course_code = excluded.course_code, term = excluded.term,
             current_score = excluded.current_score, current_grade = excluded.current_grade, html_url = excluded.html_url`,
        userId, c.id, c.name, c.course_code, c.term ?? null, c.current_score ?? null, c.current_grade ?? null, c.html_url);
    }
    const courseIds = new Set(courses.map(c => c.id));
    for (const r of await q.all<{ canvas_id: string }>('SELECT canvas_id FROM courses WHERE user_id = ?', userId)) {
      if (!courseIds.has(r.canvas_id)) await q.run('DELETE FROM courses WHERE user_id = ? AND canvas_id = ?', userId, r.canvas_id);
    }

    // ----- assignments & submissions -----
    const prevA = await loadSnapshot<CanvasAssignment>(userId, 'assignment');
    const keepA = new Set<string>();
    for (const c of courses) {
      let assignments: CanvasAssignment[] = [];
      try { assignments = await source.assignments(c.id); } catch (e) { console.warn(`[sync] assignments failed for course ${c.id}:`, (e as Error).message); continue; }
      const quiet = muted.has(c.id);
      for (const a of assignments) {
        const key = `${c.id}:${a.id}`;
        keepA.add(key);
        const prev = prevA.get(key);
        const s = a.submission;
        const gradeVisible = s.score != null && (s.posted_at != null || s.workflow_state === 'graded');
        const common = { course_id: c.id, course_name: c.name, url: a.html_url };
        if (!prev) {
          if (initial) {
            // Seed the feed with recent history so the first screen is not empty.
            if (gradeVisible && s.graded_at && now() - new Date(s.graded_at).getTime() < 14 * D) {
              await emit(user, { ...common, category: 'grade_posted', title: `${a.name}: ${fmtScore(a)}${pct(a)}`, body: `Grade posted in ${c.name}.`, dedupe_key: `grade:${key}:${s.graded_at}`, created_at: new Date(s.graded_at).getTime(), silent: true, meta: { assignment_key: key, score: s.score, points: a.points_possible } });
            }
            for (const cm of s.comments) {
              if (now() - new Date(cm.created_at).getTime() < 14 * D) await emit(user, { ...common, category: 'submission_comment', title: `${cm.author_name} commented on ${a.name}`, body: cm.comment, dedupe_key: `comment:${key}:${cm.id}`, created_at: new Date(cm.created_at).getTime(), silent: true, meta: { assignment_key: key } });
            }
          } else if (a.published && !quiet) {
            await emit(user, { ...common, category: 'assignment_created', title: `New: ${a.name}`, body: a.due_at ? `Due ${fmtDue(a.due_at, settings.timezone)}${a.points_possible != null ? ` · ${a.points_possible} pts` : ''}` : 'No due date', dedupe_key: `assignment_created:${key}`, meta: { assignment_key: key, due_at: a.due_at } });
          }
        } else if (!quiet) {
          const ps = prev.submission;
          if (a.due_at && prev.due_at !== a.due_at) {
            await emit(user, { ...common, category: 'due_date_changed', title: `Due date changed: ${a.name}`, body: `${prev.due_at ? `Was ${fmtDue(prev.due_at, settings.timezone)}, ` : ''}now due ${fmtDue(a.due_at, settings.timezone)}.`, dedupe_key: `due_changed:${key}:${a.due_at}`, meta: { assignment_key: key, due_at: a.due_at } });
          }
          const prevVisible = ps.score != null && (ps.posted_at != null || ps.workflow_state === 'graded');
          if (gradeVisible && !prevVisible) {
            await emit(user, { ...common, category: 'grade_posted', title: `${a.name}: ${fmtScore(a)}${pct(a)}`, body: `Grade posted in ${c.name}.`, dedupe_key: `grade:${key}:${s.graded_at ?? now()}`, meta: { assignment_key: key, score: s.score, points: a.points_possible } });
          } else if (gradeVisible && prevVisible && ps.score !== s.score) {
            await emit(user, { ...common, category: 'grade_changed', title: `${a.name}: ${ps.grade ?? ps.score} → ${fmtScore(a)}${pct(a)}`, body: `Grade updated in ${c.name}.`, dedupe_key: `grade_changed:${key}:${s.graded_at ?? now()}:${s.score}`, meta: { assignment_key: key, score: s.score, previous: ps.score, points: a.points_possible } });
          }
          const seen = new Set(ps.comments.map(x => x.id));
          for (const cm of s.comments) {
            if (!seen.has(cm.id)) await emit(user, { ...common, category: 'submission_comment', title: `${cm.author_name} commented on ${a.name}`, body: cm.comment, dedupe_key: `comment:${key}:${cm.id}`, meta: { assignment_key: key } });
          }
        }
        await putSnapshot(userId, 'assignment', key, a);
      }
      await pruneSnapshot(userId, 'assignment', keepA, `${c.id}:`);
    }

    // ----- announcements -----
    const prevAnn = await loadSnapshot<CanvasAnnouncement>(userId, 'announcement');
    let anns: CanvasAnnouncement[] = [];
    try { anns = await source.announcements(courses.map(c => c.id), new Date(now() - 14 * D).toISOString()); } catch (e) { console.warn('[sync] announcements failed:', (e as Error).message); }
    for (const an of anns) {
      if (!prevAnn.has(an.id) && !muted.has(an.course_id)) {
        await emit(user, { category: 'announcement', title: an.title, body: stripHtml(an.message).slice(0, 400), course_id: an.course_id, course_name: courseName.get(an.course_id) ?? null, url: an.html_url, dedupe_key: `announcement:${an.id}`, created_at: initial ? new Date(an.posted_at).getTime() : undefined, silent: initial, meta: { author: an.author_name } });
      }
      await putSnapshot(userId, 'announcement', an.id, an);
    }

    // ----- inbox conversations -----
    const prevConv = await loadSnapshot<CanvasConversation>(userId, 'conversation');
    let convs: CanvasConversation[] = [];
    try { convs = await source.conversations(); } catch (e) { console.warn('[sync] conversations failed:', (e as Error).message); }
    for (const cv of convs) {
      const prev = prevConv.get(cv.id);
      const isNew = !prev || prev.last_message_at !== cv.last_message_at;
      if (isNew && cv.workflow_state === 'unread' && (!initial || now() - new Date(cv.last_message_at).getTime() < 7 * D)) {
        await emit(user, { category: 'conversation_message', title: `${cv.last_author_name}: ${cv.subject}`, body: cv.last_message, course_id: cv.course_id ?? null, course_name: cv.course_id ? courseName.get(cv.course_id) ?? null : null, url: cv.html_url, dedupe_key: `conversation:${cv.id}:${cv.last_message_at}`, created_at: initial ? new Date(cv.last_message_at).getTime() : undefined, silent: initial });
      }
      await putSnapshot(userId, 'conversation', cv.id, cv);
    }

    // ----- discussions -----
    const prevDisc = await loadSnapshot<CanvasDiscussion>(userId, 'discussion');
    for (const c of courses) {
      let discs: CanvasDiscussion[] = [];
      try { discs = await source.discussions(c.id); } catch { continue; }
      for (const d of discs) {
        const prev = prevDisc.get(d.id);
        const grew = prev ? d.unread_count > prev.unread_count : d.unread_count > 0;
        if (grew && !muted.has(c.id)) {
          const delta = prev ? d.unread_count - prev.unread_count : d.unread_count;
          await emit(user, { category: 'discussion_reply', title: `${delta} new repl${delta === 1 ? 'y' : 'ies'} in ${d.title}`, body: `${d.unread_count} unread in ${c.name}.`, course_id: c.id, course_name: c.name, url: d.html_url, dedupe_key: `discussion:${d.id}:${d.last_reply_at}:${d.unread_count}`, created_at: initial && d.last_reply_at ? new Date(d.last_reply_at).getTime() : undefined, silent: initial });
        }
        await putSnapshot(userId, 'discussion', d.id, d);
      }
    }

    await q.run('UPDATE users SET last_sync_at = ?, last_sync_error = NULL WHERE id = ?', now(), userId);
    await evaluateTimeRules(userId);
    console.log(`[sync] user ${userId} (${user.auth_mode}) done in ${now() - t0}ms, ${created} new notification(s)`);
  } catch (e: any) {
    console.error(`[sync] user ${userId} failed:`, e?.message ?? e);
    await q.run('UPDATE users SET last_sync_error = ? WHERE id = ?', String(e?.message ?? e).slice(0, 300), userId);
  } finally {
    running.delete(userId);
  }
  return { created };
}

export async function syncAllUsers() {
  for (const u of await allUsers()) await syncUser(u.id);
}

// ---------- time-based rules (no Canvas calls) ----------
export async function evaluateTimeRules(userId: number) {
  const user = await getUser(userId);
  if (!user) return;
  const settings = getSettings(user);
  const muted = new Set((await q.all<{ canvas_id: string }>('SELECT canvas_id FROM courses WHERE user_id = ? AND muted = 1', userId)).map(r => r.canvas_id));
  const courseName = new Map((await q.all<{ canvas_id: string; name: string }>('SELECT canvas_id, name FROM courses WHERE user_id = ?', userId)).map(r => [r.canvas_id, r.name]));
  const assignments = [...(await loadSnapshot<CanvasAssignment>(userId, 'assignment')).entries()];
  const t = now();
  const windows = [...settings.dueWindows].sort((a, b) => a - b);

  for (const [key, a] of assignments) {
    if (!a.due_at || muted.has(a.course_id) || !a.published) continue;
    const s = a.submission;
    const outstanding = s.workflow_state === 'unsubmitted' && !s.excused && s.score == null;
    if (!outstanding) continue;
    const due = new Date(a.due_at).getTime();
    const onlineTypes = a.submission_types.some(x => x.startsWith('online') || x === 'discussion_topic' || x === 'external_tool');
    const common = { course_id: a.course_id, course_name: courseName.get(a.course_id) ?? null, url: a.html_url, meta: { assignment_key: key, due_at: a.due_at } };
    if (due > t) {
      const remaining = due - t;
      const w = windows.find(mins => remaining <= mins * 60_000);
      if (w !== undefined) {
        await emit(user, { ...common, category: 'due_reminder', title: `Due ${humanIn(remaining)}: ${a.name}`, body: `${courseName.get(a.course_id) ?? ''} · due ${fmtDue(a.due_at, settings.timezone)}${a.points_possible != null ? ` · ${a.points_possible} pts` : ''}`, dedupe_key: `due_reminder:${key}:${w}:${a.due_at}` });
      }
    } else if (settings.missingAlerts && (s.missing || onlineTypes) && t - due < 14 * D) {
      await emit(user, { ...common, category: 'missing_assignment', title: `Missing: ${a.name}`, body: `Was due ${fmtDue(a.due_at, settings.timezone)} in ${courseName.get(a.course_id) ?? 'a course'}. Nothing submitted.`, dedupe_key: `missing:${key}:${a.due_at}` });
    }
  }

  // custom reminders
  for (const r of await q.all<{ id: number; title: string; note: string | null; assignment_key: string | null; remind_at: number }>('SELECT * FROM reminders WHERE user_id = ? AND fired = 0 AND remind_at <= ?', userId, t)) {
    const a = r.assignment_key ? (await loadSnapshot<CanvasAssignment>(userId, 'assignment')).get(r.assignment_key) : undefined;
    await emit(user, { category: 'reminder', title: r.title, body: r.note ?? (a?.due_at ? `Due ${fmtDue(a.due_at, settings.timezone)}` : ''), course_id: a?.course_id ?? null, course_name: a ? courseName.get(a.course_id) ?? null : null, url: a?.html_url ?? null, dedupe_key: `reminder:${r.id}`, meta: { reminder_id: r.id } });
    await q.run('UPDATE reminders SET fired = 1 WHERE id = ?', r.id);
  }

  async function emit(u: UserRow, input: Parameters<typeof createNotification>[1]) { return createNotification(u, input); }
}

export async function evaluateAllTimeRules() {
  for (const u of await allUsers()) { try { await evaluateTimeRules(u.id); } catch (e) { console.error('[rules]', e); } }
}

// ---------- formatting ----------
export function fmtDue(iso: string, tz: string): string {
  try { return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return new Date(iso).toUTCString(); }
}
export function humanIn(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}
