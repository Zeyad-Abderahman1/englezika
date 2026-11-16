/**
 * Read-only helpers for the assistant's safe delete flow: finding the candidate items and
 * counting what a delete would remove. NO deletion logic lives here: deleting always goes
 * through the existing services (course / lecture / exam / assignment delete).
 */

export type DeleteKind = 'course' | 'lecture' | 'exam' | 'assignment';

export const DELETE_KINDS: DeleteKind[] = ['course', 'lecture', 'exam', 'assignment'];

export const DELETE_TOOL_BY_KIND: Record<DeleteKind, string> = {
  course: 'delete_course',
  lecture: 'delete_lecture',
  exam: 'delete_exam',
  assignment: 'delete_assignment',
};

/** Tools that destroy data. Their confirmations need the typed name (checked server-side). */
export const DESTRUCTIVE_ACTIONS = new Set(Object.values(DELETE_TOOL_BY_KIND));

export const KIND_LABEL: Record<DeleteKind, string> = {
  course: 'الكورس',
  lecture: 'المحاضرة',
  exam: 'الامتحان',
  assignment: 'الواجب',
};

export interface DeleteCandidate {
  id: string;
  title: string;
  /** Class for courses, parent course title for lectures/exams/assignments. */
  subtitle?: string;
  /** Short count shown on the chip (students, attempts, submissions...). */
  stat?: string;
}

export interface DeleteImpact {
  kind: DeleteKind;
  id: string;
  name: string;
  status?: string;
  /** Raw counts used to build the labelled summary AND to detect changes before executing. */
  counts: Record<string, number>;
}

type Queryable = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>;
};

function rowsOf(result: Awaited<ReturnType<Queryable['query']>>): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  return result?.rows ?? [];
}

const num = (value: unknown) => Number(value ?? 0) || 0;

export async function findDeletableItems(db: Queryable, kind: DeleteKind, query: string): Promise<DeleteCandidate[]> {
  const like = `%${query.trim().replace(/[%_\\]/g, ' ').slice(0, 80)}%`;
  const hasQuery = query.trim().length > 0;

  switch (kind) {
    case 'course': {
      const result = await db.query(
        `SELECT c.id, c.title, c.grade,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'approved') AS students
         FROM courses c
         WHERE ($1 = false OR c.title ILIKE $2)
         ORDER BY c.created_at DESC LIMIT 30`,
        [hasQuery, like]
      );
      return rowsOf(result).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        subtitle: row.grade ? String(row.grade) : undefined,
        stat: `${num(row.students)} طالب`,
      }));
    }
    case 'lecture': {
      const result = await db.query(
        `SELECT v.id, v.title, c.title AS course_title,
          (SELECT COUNT(*) FROM video_progress p WHERE p.video_id = v.id) AS viewers
         FROM videos v LEFT JOIN courses c ON c.id = v.course_id
         WHERE ($1 = false OR v.title ILIKE $2)
         ORDER BY v.created_at DESC LIMIT 30`,
        [hasQuery, like]
      );
      return rowsOf(result).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        subtitle: row.course_title ? String(row.course_title) : undefined,
        stat: `${num(row.viewers)} مشاهدة مسجلة`,
      }));
    }
    case 'exam': {
      const result = await db.query(
        `SELECT x.id, x.title, c.title AS course_title,
          (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = x.id) AS attempts
         FROM exams x LEFT JOIN courses c ON c.id = x.course_id
         WHERE ($1 = false OR x.title ILIKE $2)
         ORDER BY x.created_at DESC LIMIT 30`,
        [hasQuery, like]
      );
      return rowsOf(result).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        subtitle: row.course_title ? String(row.course_title) : 'امتحان عام',
        stat: `${num(row.attempts)} محاولة`,
      }));
    }
    case 'assignment': {
      const result = await db.query(
        `SELECT a.id, a.title, c.title AS course_title,
          (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id) AS submissions
         FROM assignments a LEFT JOIN courses c ON c.id = a.course_id
         WHERE ($1 = false OR a.title ILIKE $2)
         ORDER BY a.created_at DESC LIMIT 30`,
        [hasQuery, like]
      );
      return rowsOf(result).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        subtitle: row.course_title ? String(row.course_title) : undefined,
        stat: `${num(row.submissions)} تسليم`,
      }));
    }
  }
}

async function count(db: Queryable, sql: string, id: string): Promise<number> {
  try {
    return num(rowsOf(await db.query(sql, [id]))[0]?.total);
  } catch {
    return 0;
  }
}

export async function computeDeleteImpact(db: Queryable, kind: DeleteKind, id: string): Promise<DeleteImpact | null> {
  switch (kind) {
    case 'course': {
      const row = rowsOf(await db.query('SELECT id, title, status, thumbnail_key FROM courses WHERE id = $1', [id]))[0];
      if (!row) return null;
      const counts: Record<string, number> = {
        lectures: await count(db, 'SELECT COUNT(*) AS total FROM videos WHERE course_id = $1', id),
        exams: await count(db, 'SELECT COUNT(*) AS total FROM exams WHERE course_id = $1', id),
        assignments: await count(db, 'SELECT COUNT(*) AS total FROM assignments WHERE course_id = $1', id),
        activeEnrollments: await count(db, "SELECT COUNT(*) AS total FROM enrollments WHERE course_id = $1 AND status = 'approved'", id),
        pendingEnrollments: await count(db, "SELECT COUNT(*) AS total FROM enrollments WHERE course_id = $1 AND status = 'pending'", id),
        payments: await count(db, 'SELECT COUNT(*) AS total FROM payment_intents WHERE course_id = $1', id),
        attempts: await count(db, 'SELECT COUNT(*) AS total FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = $1)', id),
        materials: await count(db, 'SELECT COUNT(*) AS total FROM lecture_materials WHERE video_id IN (SELECT id FROM videos WHERE course_id = $1)', id),
        accessCodes: await count(db, 'SELECT COUNT(*) AS total FROM lecture_access_codes WHERE course_id = $1', id),
        thumbnail: row.thumbnail_key ? 1 : 0,
      };
      return { kind, id, name: String(row.title ?? ''), status: String(row.status ?? ''), counts };
    }
    case 'lecture': {
      const row = rowsOf(await db.query('SELECT id, title, status FROM videos WHERE id = $1', [id]))[0];
      if (!row) return null;
      const counts: Record<string, number> = {
        viewers: await count(db, 'SELECT COUNT(*) AS total FROM video_progress WHERE video_id = $1', id),
        accessCodes: await count(db, 'SELECT COUNT(*) AS total FROM lecture_access_codes WHERE video_id = $1', id),
        materials: await count(db, 'SELECT COUNT(*) AS total FROM lecture_materials WHERE video_id = $1', id),
      };
      return { kind, id, name: String(row.title ?? ''), status: String(row.status ?? ''), counts };
    }
    case 'exam': {
      const row = rowsOf(
        await db.query(
          'SELECT id, title, status, thumbnail_key, teacher_file_key, published_as_course FROM exams WHERE id = $1',
          [id]
        )
      )[0];
      if (!row) return null;
      const counts: Record<string, number> = {
        questions: await count(db, 'SELECT COUNT(*) AS total FROM questions WHERE exam_id = $1', id),
        attempts: await count(db, 'SELECT COUNT(*) AS total FROM attempts WHERE exam_id = $1', id),
        students: await count(db, 'SELECT COUNT(DISTINCT user_email) AS total FROM attempts WHERE exam_id = $1', id),
        listing: row.published_as_course ? 1 : 0,
        files: (row.thumbnail_key ? 1 : 0) + (row.teacher_file_key ? 1 : 0),
      };
      return { kind, id, name: String(row.title ?? ''), status: String(row.status ?? ''), counts };
    }
    case 'assignment': {
      const row = rowsOf(await db.query('SELECT id, title, status, teacher_file_key FROM assignments WHERE id = $1', [id]))[0];
      if (!row) return null;
      const counts: Record<string, number> = {
        submissions: await count(db, 'SELECT COUNT(*) AS total FROM assignment_submissions WHERE assignment_id = $1', id),
        questions: await count(db, 'SELECT COUNT(*) AS total FROM assignment_questions WHERE assignment_id = $1', id),
        files: row.teacher_file_key ? 1 : 0,
      };
      return { kind, id, name: String(row.title ?? ''), status: String(row.status ?? ''), counts };
    }
  }
}

/** Stable text of the counts, used to detect that something changed between the card and the delete. */
export function impactSignature(counts: Record<string, number>): string {
  return Object.keys(counts)
    .sort()
    .map((key) => `${key}=${counts[key]}`)
    .join('&');
}

const COUNT_LABELS: Record<DeleteKind, Array<[string, string]>> = {
  course: [
    ['lectures', 'المحاضرات'],
    ['exams', 'الامتحانات'],
    ['assignments', 'الواجبات'],
    ['activeEnrollments', 'الطلاب المشتركون'],
    ['pendingEnrollments', 'طلبات اشتراك معلقة'],
    ['payments', 'عمليات الدفع (تُحفظ للمراجعة المالية)'],
    ['attempts', 'محاولات الامتحانات ونتائجها'],
    ['materials', 'ملفات المحاضرات'],
    ['accessCodes', 'أكواد الدخول'],
    ['thumbnail', 'صورة الكورس'],
  ],
  lecture: [
    ['viewers', 'سجلات المشاهدة'],
    ['accessCodes', 'أكواد الدخول'],
    ['materials', 'ملفات المحاضرة'],
  ],
  exam: [
    ['questions', 'الأسئلة'],
    ['attempts', 'محاولات الطلاب ونتائجها'],
    ['students', 'الطلاب الذين حلّوه'],
    ['listing', 'منشور ككورس لكل الصفوف'],
    ['files', 'ملفات مرفوعة'],
  ],
  assignment: [
    ['submissions', 'تسليمات الطلاب'],
    ['questions', 'الأسئلة'],
    ['files', 'ملفات مرفوعة'],
  ],
};

/** Counts that mean "students/money/results depend on this item": hiding is offered first. */
const DEPENDENT_KEYS: Record<DeleteKind, string[]> = {
  course: ['activeEnrollments', 'pendingEnrollments', 'payments', 'attempts'],
  lecture: ['viewers'],
  exam: ['attempts', 'listing'],
  assignment: ['submissions'],
};

export function impactRows(impact: DeleteImpact): Array<{ label: string; value: string }> {
  return COUNT_LABELS[impact.kind]
    .filter(([key]) => (impact.counts[key] ?? 0) > 0)
    .map(([key, label]) => ({ label, value: String(impact.counts[key]) }));
}

export function hasDependents(impact: DeleteImpact): boolean {
  return DEPENDENT_KEYS[impact.kind].some((key) => (impact.counts[key] ?? 0) > 0);
}
