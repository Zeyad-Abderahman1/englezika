import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { getDatabase } from '../../../lib/platform';
import { jsonError, safeText } from '../../../lib/security';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser(request);
  if (isResponse(user)) return user;
  const { id } = await params;
  const email = user.email.toLowerCase();

  // Rate limit: 30 requests per minute per IP + account
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit('student-exam-review', `${clientIp}:${email}`, 30, 60);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAfterSeconds);
  }

  const db = getDatabase();

  // Fetch the attempt — ownership check strictly in the SQL query itself
  const attempt = await db
    .prepare(
      `SELECT a.id, a.exam_id AS examId, a.status, a.score, a.max_score AS maxScore,
     a.feedback, a.grading_method AS gradingMethod,
     a.started_at AS startedAt, a.submitted_at AS submittedAt,
     x.title AS examTitle, x.passing_score AS passingScore,
     COALESCE(x.show_review, true) AS showReview
     FROM attempts a JOIN exams x ON x.id = a.exam_id
     WHERE a.id = ? AND a.user_email = ?`
    )
    .bind(id, email)
    .first<Record<string, unknown>>();

  if (!attempt) {
    return jsonError('النتيجة غير موجودة أو غير متاحة لحسابك', 404);
  }

  // Finalized attempt check: attempt must be submitted
  if (attempt.status !== 'submitted') {
    return jsonError('المحاولة لم تكتمل بعد', 403);
  }

  // Check show_review on the exam
  const showReview =
    attempt.showReview === true || attempt.showReview === 1 || String(attempt.showReview) === 'true';
  if (!showReview) {
    return jsonError('مراجعة الإجابات غير مفعلة لهذا الامتحان', 403);
  }

  // Fetch per-question answers with question details
  const answers = await db
    .prepare(
      `SELECT ans.id, ans.question_id AS questionId, ans.answer, ans.score, ans.feedback,
     q.type, q.prompt, q.options, q.correct_answer AS correctAnswer, q.explanation AS explanation,
     q.points, q.sort_order AS sortOrder,
     CASE WHEN q.image_file_key IS NOT NULL THEN 1 ELSE 0 END AS hasImage
     FROM answers ans JOIN questions q ON q.id = ans.question_id
     WHERE ans.attempt_id = ? ORDER BY q.sort_order`
    )
    .bind(id)
    .all<Record<string, unknown>>();

  const percentage =
    Number(attempt.maxScore) > 0
      ? Math.round((Number(attempt.score) / Number(attempt.maxScore)) * 100)
      : 0;

  return Response.json({
    attempt: {
      ...attempt,
      showReview: true,
      percentage,
      passed: percentage >= Number(attempt.passingScore || 50),
    },
    answers: answers.results.map((ans) => {
      let parsedOptions: string[] = [];
      if (ans.options) {
        try {
          parsedOptions = JSON.parse(String(ans.options));
        } catch {
          parsedOptions = [];
        }
      }
      return {
        id: ans.id,
        questionId: ans.questionId,
        sortOrder: ans.sortOrder,
        type: ans.type,
        prompt: ans.prompt,
        options: parsedOptions,
        correctAnswer: ans.correctAnswer,
        answer: ans.answer,
        score: ans.score,
        points: ans.points,
        feedback: ans.feedback,
        explanation:
          typeof ans.explanation === 'string' && ans.explanation.trim()
            ? safeText(ans.explanation, 1500)
            : null,
        hasImage: Boolean(ans.hasImage),
      };
    }),
  });
}
