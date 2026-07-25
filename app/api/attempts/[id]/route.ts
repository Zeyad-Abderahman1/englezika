import { ensureDatabase } from "../../../../db/runtime";
import { apiVerifiedUser, isResponse } from "../../../lib/api-auth";
import { getD1 } from "../../../lib/platform";
import { jsonError } from "../../../lib/security";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const email = user.email.toLowerCase();

  // Fetch the attempt — only the owner can read it
  const attempt = await db.prepare(
    `SELECT a.id, a.exam_id AS examId, a.score, a.max_score AS maxScore,
     a.feedback, a.grading_method AS gradingMethod,
     a.started_at AS startedAt, a.submitted_at AS submittedAt,
     x.title AS examTitle, x.passing_score AS passingScore
     FROM attempts a JOIN exams x ON x.id = a.exam_id
     WHERE a.id = ? AND a.user_email = ?`
  ).bind(id, email).first<Record<string, unknown>>();
  if (!attempt) return jsonError("النتيجة غير موجودة أو غير متاحة لحسابك", 404);

  // Fetch per-question answers with question details
  const answers = await db.prepare(
    `SELECT ans.id, ans.question_id AS questionId, ans.answer, ans.score, ans.feedback,
     q.type, q.prompt, q.options, q.correct_answer AS correctAnswer, q.points, q.sort_order AS sortOrder
     FROM answers ans JOIN questions q ON q.id = ans.question_id
     WHERE ans.attempt_id = ? ORDER BY q.sort_order`
  ).bind(id).all<Record<string, unknown>>();

  const percentage = Number(attempt.maxScore) > 0
    ? Math.round((Number(attempt.score) / Number(attempt.maxScore)) * 100)
    : 0;

  return Response.json({
    attempt: {
      ...attempt,
      percentage,
      passed: percentage >= Number(attempt.passingScore || 50),
    },
    answers: answers.results.map((ans) => ({
      ...ans,
      options: ans.options ? JSON.parse(String(ans.options)) : [],
    })),
  });
}
