import { apiUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError } from '../../../../lib/security';
import { isEmailVerified } from '../../../../lib/email-verification';

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

  // Fetch MCQ questions (without correct_index)
  let questions: Array<{ id: string; question: string; options: string[]; points: number; sortOrder: number }> = [];
  if (assignment.type === 'mcq') {
    try {
      const qResult = await db
        .prepare(
          `SELECT id, question, options, points, sort_order AS sortOrder
           FROM assignment_questions WHERE assignment_id = ? ORDER BY sort_order ASC`
        )
        .bind(id)
        .all<{ id: string; question: string; options: string; points: number; sortOrder: number }>();
      questions = qResult.results.map((q) => ({
        ...q,
        options: JSON.parse(q.options) as string[],
      }));
    } catch {
      // Table not created yet
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
  } | null = null;

  try {
    submission = await db
      .prepare(
        `SELECT id, status, score, max_score AS maxScore,
         COALESCE(feedback, '') AS feedback, submitted_at AS submittedAt,
         graded_at AS gradedAt,
         CASE WHEN pdf_storage_key IS NOT NULL THEN 1 ELSE 0 END AS hasPdf
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
      }>();
  } catch {
    // Submissions table not yet created
  }

  return Response.json({
    assignment,
    questions,
    submission,
  });
}
