export type Channel = 'push' | 'email' | 'sms';
export type Frequency = 'immediately' | 'daily' | 'never';

export type Category =
  | 'grade_posted' | 'grade_changed' | 'submission_comment' | 'announcement' | 'assignment_created'
  | 'due_date_changed' | 'due_reminder' | 'missing_assignment' | 'conversation_message'
  | 'discussion_reply' | 'reminder' | 'digest';

export interface CategoryDef {
  id: Category;
  label: string;
  group: 'Grades' | 'Assignments' | 'Course activity' | 'Messages' | 'Reminders';
  description: string;
  defaults: Record<Channel, Frequency>;
}

/** Everything Dispatch can notify about, with sane defaults (more useful than Canvas's own). */
export const CATEGORIES: CategoryDef[] = [
  { id: 'grade_posted', label: 'Grade posted', group: 'Grades', description: 'An instructor released a grade for one of your submissions.', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'grade_changed', label: 'Grade changed', group: 'Grades', description: 'A previously posted grade was updated (regrade, curve, correction).', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'submission_comment', label: 'Feedback comment', group: 'Grades', description: 'A comment was left on one of your submissions.', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'assignment_created', label: 'New assignment', group: 'Assignments', description: 'A new assignment or quiz was published in a course.', defaults: { push: 'immediately', email: 'daily', sms: 'never' } },
  { id: 'due_date_changed', label: 'Due date changed', group: 'Assignments', description: 'The due date of an assignment moved.', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'due_reminder', label: 'Due soon reminder', group: 'Reminders', description: 'Reminders before a due date for anything you have not submitted yet.', defaults: { push: 'immediately', email: 'immediately', sms: 'immediately' } },
  { id: 'missing_assignment', label: 'Missing assignment', group: 'Reminders', description: 'A due date passed with nothing submitted.', defaults: { push: 'immediately', email: 'immediately', sms: 'immediately' } },
  { id: 'reminder', label: 'Custom reminder', group: 'Reminders', description: 'Reminders you set yourself in Dispatch.', defaults: { push: 'immediately', email: 'immediately', sms: 'immediately' } },
  { id: 'announcement', label: 'Announcement', group: 'Course activity', description: 'An instructor posted a course announcement.', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'discussion_reply', label: 'Discussion activity', group: 'Course activity', description: 'New replies in discussions you are part of.', defaults: { push: 'daily', email: 'daily', sms: 'never' } },
  { id: 'conversation_message', label: 'Inbox message', group: 'Messages', description: 'A new message in your Canvas inbox.', defaults: { push: 'immediately', email: 'immediately', sms: 'never' } },
  { id: 'digest', label: 'Daily digest', group: 'Reminders', description: 'One summary per day: what is due, what changed, what you missed.', defaults: { push: 'never', email: 'daily', sms: 'never' } },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label])) as Record<Category, string>;
