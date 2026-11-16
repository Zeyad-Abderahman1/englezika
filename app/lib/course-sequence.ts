import { getDatabase } from './platform';

export type CourseItemType = 'video' | 'exam' | 'assignment';

export type CourseItem = {
  id: string;
  courseId: string;
  itemType: CourseItemType;
  videoId: string | null;
  examId: string | null;
  assignmentId: string | null;
  sortOrder: number;
  createdAt: number;
};

export type CourseItemWithDetails = CourseItem & {
  title: string;
  subtitle?: string;
  assessmentType?: string;
};

export type SequenceUnlockState = {
  unlocked: boolean;
  isCompleted: boolean;
  itemType: CourseItemType;
  title: string;
  itemId: string;
  lockReason?: 'previous_item' | null;
  assessmentType?: 'exam' | 'quiz';
};

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getCourseItems(
  courseId: string
): Promise<CourseItemWithDetails[]> {
  const db = getDatabase();
  const result = await db
    .prepare(
      `SELECT
        ci.id,
        ci.course_id AS courseId,
        ci.item_type AS itemType,
        ci.video_id AS videoId,
        ci.exam_id AS examId,
        ci.assignment_id AS assignmentId,
        ci.sort_order AS sortOrder,
        ci.created_at AS createdAt,
        COALESCE(v.title, x.title, a.title, '') AS title,
        CASE
          WHEN ci.item_type = 'exam' THEN x.assessment_type
          ELSE NULL
        END AS assessmentType
       FROM course_items ci
       LEFT JOIN videos v ON v.id = ci.video_id
       LEFT JOIN exams x ON x.id = ci.exam_id
       LEFT JOIN assignments a ON a.id = ci.assignment_id
       WHERE ci.course_id = ?
       ORDER BY ci.sort_order ASC`
    )
    .bind(courseId)
    .all<CourseItemWithDetails & { assessmentType?: string }>();

  return result.results.map((row) => ({
    ...row,
    assessmentType: row.assessmentType as string | undefined,
  })) as CourseItemWithDetails[];
}

export async function hasCourseItems(courseId: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db
    .prepare('SELECT 1 FROM course_items WHERE course_id = ? LIMIT 1')
    .bind(courseId)
    .first();
  return row !== null;
}

export async function getCourseSequenceUnlockState(
  courseId: string,
  userEmail: string
): Promise<Map<string, SequenceUnlockState>> {
  const db = getDatabase();
  const normalized = normalizedEmail(userEmail);
  const items = await getCourseItems(courseId);
  const stateMap = new Map<string, SequenceUnlockState>();

  if (items.length === 0) return stateMap;

  const videoIds = items.filter((i) => i.videoId).map((i) => i.videoId!);
  const examIds = items.filter((i) => i.examId).map((i) => i.examId!);
  const assignmentIds = items
    .filter((i) => i.assignmentId)
    .map((i) => i.assignmentId!);

  const completedVideos = new Set<string>();
  const completedExams = new Set<string>();
  const completedAssignments = new Set<string>();

  if (videoIds.length > 0) {
    const videoResult = await db
      .prepare(
        `SELECT video_id AS videoId FROM video_progress
         WHERE user_email = ? AND video_id IN (${videoIds.map(() => '?').join(',')})`
      )
      .bind(normalized, ...videoIds)
      .all<{ videoId: string }>();
    videoResult.results.forEach((r) => completedVideos.add(r.videoId));
  }

  if (examIds.length > 0) {
    const examResult = await db
      .prepare(
        `SELECT DISTINCT exam_id AS examId FROM attempts
         WHERE user_email = ? AND status = 'submitted'
         AND exam_id IN (${examIds.map(() => '?').join(',')})`
      )
      .bind(normalized, ...examIds)
      .all<{ examId: string }>();
    examResult.results.forEach((r) => completedExams.add(r.examId));
  }

  if (assignmentIds.length > 0) {
    const assignmentResult = await db
      .prepare(
        `SELECT assignment_id AS assignmentId FROM assignment_submissions
         WHERE student_email = ?
         AND status IN ('submitted', 'graded')
         AND assignment_id IN (${assignmentIds.map(() => '?').join(',')})`
      )
      .bind(normalized, ...assignmentIds)
      .all<{ assignmentId: string }>();
    assignmentResult.results.forEach((r) => completedAssignments.add(r.assignmentId));
  }

  let allPreviousCompleted = true;

  for (const item of items) {
    let isCompleted = false;

    switch (item.itemType) {
      case 'video':
        isCompleted = item.videoId ? completedVideos.has(item.videoId) : false;
        break;
      case 'exam':
        isCompleted = item.examId ? completedExams.has(item.examId) : false;
        break;
      case 'assignment':
        isCompleted = item.assignmentId
          ? completedAssignments.has(item.assignmentId)
          : false;
        break;
    }

    const unlocked = allPreviousCompleted;
    const key = `${item.itemType}:${item.videoId || item.examId || item.assignmentId}`;

    stateMap.set(key, {
      unlocked,
      isCompleted,
      itemType: item.itemType,
      title: item.title,
      itemId: item.videoId || item.examId || item.assignmentId || '',
      lockReason: unlocked ? null : 'previous_item',
      assessmentType: item.assessmentType as 'exam' | 'quiz' | undefined,
    });

    if (!isCompleted) {
      allPreviousCompleted = false;
    }
  }

  return stateMap;
}

export async function saveCourseSequence(
  courseId: string,
  items: Array<{ itemType: CourseItemType; videoId?: string; examId?: string; assignmentId?: string }>
): Promise<void> {
  const db = getDatabase();

  const statements = items.map((item, index) => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    return db.prepare(
      `INSERT INTO course_items (id, course_id, item_type, video_id, exam_id, assignment_id, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      courseId,
      item.itemType,
      item.videoId || null,
      item.examId || null,
      item.assignmentId || null,
      index,
      now
    );
  });

  await db.batch([
    db.prepare('DELETE FROM course_items WHERE course_id = ?').bind(courseId),
    ...statements,
  ]);
}
