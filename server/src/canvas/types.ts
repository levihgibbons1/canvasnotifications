/** Normalized view of the Canvas objects Dispatch cares about.
 *  Both the real Canvas REST client and the demo simulator produce these. */

export interface CanvasProfile {
  id: string;
  name: string;
  primary_email?: string;
  avatar_url?: string;
}

export interface CanvasCourse {
  id: string;
  name: string;
  course_code: string;
  term?: string;
  current_score?: number | null;
  current_grade?: string | null;
  html_url: string;
}

export interface CanvasSubmissionComment {
  id: string;
  author_name: string;
  comment: string;
  created_at: string;
}

export interface CanvasSubmission {
  workflow_state: 'unsubmitted' | 'submitted' | 'graded' | 'pending_review';
  score: number | null;
  grade: string | null;
  graded_at: string | null;
  posted_at: string | null;
  submitted_at: string | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  comments: CanvasSubmissionComment[];
}

export interface CanvasAssignment {
  id: string;
  course_id: string;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  published: boolean;
  submission_types: string[];
  submission: CanvasSubmission;
}

export interface CanvasAnnouncement {
  id: string;
  course_id: string;
  title: string;
  message: string; // HTML
  posted_at: string;
  author_name: string;
  html_url: string;
}

export interface CanvasConversation {
  id: string;
  subject: string;
  last_message: string;
  last_message_at: string;
  last_author_name: string;
  workflow_state: 'read' | 'unread' | 'archived';
  message_count: number;
  html_url: string;
  course_id?: string;
}

export interface CanvasDiscussion {
  id: string;
  course_id: string;
  title: string;
  unread_count: number;
  last_reply_at: string | null;
  html_url: string;
}

export interface CanvasSource {
  profile(): Promise<CanvasProfile>;
  courses(): Promise<CanvasCourse[]>;
  assignments(courseId: string): Promise<CanvasAssignment[]>;
  announcements(courseIds: string[], sinceIso: string): Promise<CanvasAnnouncement[]>;
  conversations(): Promise<CanvasConversation[]>;
  discussions(courseId: string): Promise<CanvasDiscussion[]>;
}
