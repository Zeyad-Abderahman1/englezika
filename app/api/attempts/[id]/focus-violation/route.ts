import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';

type QuestionRow = {
  id: string;
  points: number;
  correctAnswer: string;
  type: string;
};

/**
 * POST /api/attempts/[id]/focus-violation
 *
 * Records a focus violation (leaving the exam page / switching apps or tabs).
 * Violation 1: Returns violationCount: 1, terminated: false.
 * Violation 2: Immediately terminates the exam attempt on the server,
 *              persists available answers, and marks status = 'terminated'.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser(request);
  if (isResponse(user)) return user;

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();
  const now = Date.now();

  // Find the session or attempt
  const session = await db
    .prepare(
      `SELECT id, exam_id AS examId, user_email AS userEmail,
              started_at AS startedAt, expires_at AS expiresAt, status
       FROM exam_sessions WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: string;
      examId: string;
      userEmail: string;
      startedAt: number;
      expiresAt: number;
      status: string;
    }>();

  if (!session) {
    // Check if it exists as an already terminated attempt
    const attempt = await db
      .prepare('SELECT id, user_email AS userEmail, status FROM attempts WHERE id = ?')
      .bind(id)
      .first<{ id: string; userEmail: string; status: string }>();

    if (attempt) {
      if (attempt.userEmail.toLowerCase() !== email) {
        return jsonError('غير مصرح بالدخول', 403);
      }
      return Response.json({
        violationCount: 2,
        terminated: true,
        message: 'الامتحان منتهي بالفعل',
      });
    }

    return jsonError('جلسة الامتحان غير موجودة', 404);
  }

  if (session.userEmail.toLowerCase() !== email) {
    return jsonError('غير مصرح بالدخول', 403);
  }

  if (session.status === 'terminated' || session.status === 'submitted') {
    return Response.json({
      violationCount: 2,
      terminated: true,
      message: 'الامتحان منتهي بالفعل',
    });
  }

  // Ensure violations table exists
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS exam_focus_violations (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        exam_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        violation_number INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      )`
    )
    .run()
    .catch(() => {});

  // Check existing violations for duplicate event protection
  const violationStats = await db
    .prepare(
      `SELECT COUNT(*) AS count, MAX(created_at) AS lastViolationAt
       FROM exam_focus_violations
       WHERE attempt_id = ? AND user_email = ?`
    )
    .bind(id, email)
    .first<{ count: number; lastViolationAt: number | null }>();

  const rawStats = violationStats as Record<string, unknown> | null;
  const currentCount = Number(rawStats?.count || 0);
  const lastAt = Number(rawStats?.lastViolationAt ?? rawStats?.lastviolationat ?? 0) || 0;

  // Deduplicate: if an event arrived within 3 seconds of the last one, ignore as duplicate
  if (lastAt > 0 && now - lastAt < 3000) {
    return Response.json({
      violationCount: currentCount,
      terminated: currentCount >= 2,
    });
  }

  if (currentCount === 0) {
    // First violation
    await db
      .prepare(
        `INSERT INTO exam_focus_violations (id, attempt_id, exam_id, user_email, violation_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, session.examId, email, 1, now)
      .run();

    return Response.json({
      violationCount: 1,
      terminated: false,
    });
  }

  // Second violation: record and TERMINATE immediately
  await db
    .prepare(
      `INSERT INTO exam_focus_violations (id, attempt_id, exam_id, user_email, violation_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), id, session.examId, email, 2, now)
    .run();

  // Read available student answers from request body if available
  const body = (await request.json().catch(() => ({}))) as {
    answers?: Record<string, string>;
  };
  const studentAnswers = body?.answers || {};

  // Fetch questions to score available answers
  const questionsResult = await db
    .prepare(
      `SELECT id, points, correct_answer AS correctAnswer, type
       FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(session.examId)
    .all<QuestionRow>();

  const questions = questionsResult.results || [];
  let score = 0;
  let maxScore = 0;

  const answersToInsert: Array<{
    questionId: string;
    answer: string;
    score: number;
    feedback: string;
  }> = [];

  for (const q of questions) {
    const points = Number(q.points || 1);
    maxScore += points;
    const ans = typeof studentAnswers[q.id] === 'string' ? studentAnswers[q.id].trim() : '';

    let qScore = 0;
    let feedback = '';

    if (ans) {
      if (q.type === 'multiple_choice' || q.type === 'true_false') {
        if (ans.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase()) {
          qScore = points;
          feedback = 'إجابة صحيحة';
        } else {
          feedback = `إجابة غير صحيحة. الإجابة الصحيحة هي: ${q.correctAnswer}`;
        }
      }
    }

    score += qScore;
    answersToInsert.push({
      questionId: q.id,
      answer: ans,
      score: qScore,
      feedback,
    });
  }

  const attemptId = crypto.randomUUID();
  const startedAt = Number(session.startedAt || now);

  // Terminate session and insert attempt in database
  await db
    .prepare("UPDATE exam_sessions SET status = 'terminated' WHERE id = ?")
    .bind(id)
    .run();

  await db
    .prepare(
      `INSERT INTO attempts
       (id, exam_id, user_email, status, score, max_score, feedback, grading_method, started_at, submitted_at)
       VALUES (?, ?, ?, 'terminated', ?, ?, ?, 'focus_violation', ?, ?)`
    )
    .bind(
      attemptId,
      session.examId,
      email,
      score,
      maxScore,
      'تم إنهاء الامتحان بسبب مغادرة صفحة الامتحان للمرة الثانية.',
      startedAt,
      now
    )
    .run();

  // Save student's partial answers if available
  for (const item of answersToInsert) {
    if (item.answer) {
      await db
        .prepare(
          `INSERT INTO answers (id, attempt_id, question_id, answer, score, feedback)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          attemptId,
          item.questionId,
          item.answer,
          item.score,
          item.feedback
        )
        .run()
        .catch(() => {});
    }
  }

  return Response.json({
    violationCount: 2,
    terminated: true,
    message: 'تم إنهاء الامتحان. تم تسجيل مغادرة صفحة الامتحان للمرة الثانية.',
  });
}
