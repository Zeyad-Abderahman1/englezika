import { apiUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError } from '../../../../lib/security';
import { isEmailVerified } from '../../../../lib/email-verification';
import { hasCourseItems, getCourseSequenceUnlockState } from '../../../../lib/course-sequence';

/**
 * GET /api/student/assignments/[id]
 *
 * Returns assignment details for an enrolled student, including:
 * - Assignment metadata (title, description, due date, type, max score)
 * - Whether a teacher file is available to download
 * - MCQ questions (without correct answers) if type = 'mcq'
 * - Student's own submission status
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;

  if (!(await isEmailVerified(user.email))) {
    return jsonError('يجب تأكيد البريد الإلكتروني أولاً', 403);
  }

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();

  // Verify student is enrolled in the assignment's course
  const assignment = await db
    .prepare(
      `SELECT a.id, a.title, a.description, a.due_at AS dueAt,
       COALESCE(a.type, 'pdf') AS type, a.max_score AS maxScore,
       a.status, a.course_id AS courseId,
       CASE WHEN a.teacher_file_key IS NOT NULL THEN 1 ELSE 0 END AS hasTeacherFile
       FROM assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.id = ? AND e.user_email = ? AND e.status = 'approved'
         AND a.status = 'published'`
    )
    .bind(id, email)
    .first<{
      id: string;
      title: string;
      description: string;
      dueAt: number | null;
      type: string;
      maxScore: number;
      status: string;
      courseId: string;
      hasTeacherFile: number;
    }>();

  if (!assignment) return jsonError('الواجب غير متاح', 404);

  const courseHasSequence = await hasCourseItems(assignment.courseId);
  if (courseHasSequence) {
    const unlockState = await getCourseSequenceUnlockState(assignment.courseId, email);
    const key = `assignment:${id}`;
    const state = unlockState.get(key);
    if (state && !state.unlocked) {
      return jsonError('يجب إكمال العناصر السابقة في تسلسل التعلم أولاً', 403);
    }
  }

  // Fetch student's existing submission if any
  let submission: {
    id: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    feedback: string;
    submittedAt: number;
    gradedAt: number | null;
    hasPdf: number;
    mcqAnswers: Record<string, number> | null;
  } | null = null;

  try {
    const subRow = await db
      .prepare(
        `SELECT id, status, score, max_score AS maxScore,
         COALESCE(feedback, '') AS feedback, submitted_at AS submittedAt,
         graded_at AS gradedAt,
         CASE WHEN pdf_storage_key IS NOT NULL THEN 1 ELSE 0 END AS hasPdf,
         mcq_answers AS mcqAnswers
         FROM assignment_submissions
         WHERE assignment_id = ? AND student_email = ? LIMIT 1`
      )
      .bind(id, email)
      .first<{
        id: string;
        status: string;
        score: number | null;
        maxScore: number | null;
        feedback: string;
        submittedAt: number;
        gradedAt: number | null;
        hasPdf: number;
        mcqAnswers: string | null;
      }>();
    if (subRow) {
      let mcqAnswersMap: Record<string, number> | null = null;
      if (subRow.mcqAnswers) {
        try {
          const parsed = JSON.parse(subRow.mcqAnswers) as Array<{ questionId: string; chosen: number }>;
          mcqAnswersMap = {};
          for (const item of parsed) {
            mcqAnswersMap[item.questionId] = item.chosen;
          }
        } catch {
          // ignore parse errors
        }
      }
      submission = {
        id: subRow.id,
        status: subRow.status,
        score: subRow.score,
        maxScore: subRow.maxScore,
        feedback: subRow.feedback,
        submittedAt: subRow.submittedAt,
        gradedAt: subRow.gradedAt,
        hasPdf: subRow.hasPdf,
        mcqAnswers: mcqAnswersMap,
      };
    }
  } catch {
    // Submissions table not yet created
  }

  // Fetch MCQ questions — include correctIndex and explanation only after submission
  let questions: Array<{ id: string; question: string; explanation: string | null; options: string[]; correctIndex: number | null; points: number; sortOrder: number; hasImage: boolean }> = [];
  if (assignment.type === 'mcq') {
    try {
      const qResult = await db
        .prepare(
          `SELECT id, question, explanation, options, correct_index AS correctIndex, points, sort_order AS sortOrder,
                  image_file_key AS imageFileKey
           FROM assignment_questions WHERE assignment_id = ? ORDER BY sort_order ASC`
        )
        .bind(id)
        .all<{ id: string; question: string; explanation: string | null; options: string; correctIndex: number; points: number; sortOrder: number; imageFileKey: string | null }>();
      const hasSubmission = submission != null;
      questions = qResult.results.map((q) => ({
        id: q.id,
        question: q.question,
        explanation: q.explanation || null,
        options: JSON.parse(q.options) as string[],
        correctIndex: hasSubmission ? q.correctIndex : null,
        points: q.points,
        sortOrder: q.sortOrder,
        hasImage: q.imageFileKey != null,
      }));
    } catch {
      // Table not created yet
    }
  }

  return Response.json({
    assignment,
    questions,
    submission,
  });
}
