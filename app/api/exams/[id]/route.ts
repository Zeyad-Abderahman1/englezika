import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { examAvailabilityError, loadStudentExam } from '../../../lib/exam-access';
import { gradeWrittenAnswers, type WrittenGradingInput } from '../../../lib/grading';
import { claimExamSession, releaseExamSessionClaim } from '../../../lib/exam-session';
import { getDatabase } from '../../../lib/platform';
import { invalidateLeaderboardCache } from '../../../lib/leaderboard-cache';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import {
  jsonError,
  requestBodyWithinLimit,
  requireSameOrigin,
  safeText,
} from '../../../lib/security';

type QuestionRow = {
  id: string;
  type: string;
  prompt: string;
  options: string | null;
  correctAnswer: string;
  rubric: string;
  points: number;
  sortOrder: number;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const email = user.email.toLowerCase();
  const exam = await loadStudentExam(id, email);
  if (!exam) return jsonError('الامتحان غير متاح لحسابك', 404);
  const availabilityError = examAvailabilityError(exam, Date.now());
  if (availabilityError === 'not-open') return jsonError('الامتحان لم يبدأ بعد', 403);
  if (availabilityError === 'closed') return jsonError('انتهى وقت إتاحة الامتحان', 403);

  const session = await getDatabase()
    .prepare(
      `SELECT id, started_at AS startedAt, expires_at AS expiresAt, status
       FROM exam_sessions WHERE exam_id = ? AND user_email = ?`
    )
    .bind(id, email)
    .first<{ id: string; startedAt: number; expiresAt: number; status: string }>();
  if (!session || session.status !== 'active' || Number(session.expiresAt) <= Date.now()) {
    return jsonError('ابدأ الامتحان من حسابك أولاً', 409);
  }

  const result = await getDatabase()
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options, points
       FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(id)
    .all();
  return Response.json({
    exam,
    session,
    questions: result.results.map((question) => ({
      ...question,
      options: question.options ? JSON.parse(String(question.options)) : [],
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  if (!requestBodyWithinLimit(request, 768 * 1024)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }
  const { id } = await params;
  const email = user.email.toLowerCase();
  const submitRate = await checkRateLimit('exam-submit', `${getClientIp(request)}:${email}`, 10, 60);
  if (!submitRate.allowed) return rateLimitResponse(submitRate.resetAfterSeconds);
  const exam = await loadStudentExam(id, email);
  if (!exam) return jsonError('الامتحان غير متاح لحسابك', 404);
  const now = Date.now();
  const availabilityError = examAvailabilityError(exam, now);
  if (availabilityError === 'not-open') return jsonError('الامتحان لم يبدأ بعد', 403);
  if (availabilityError === 'closed') return jsonError('انتهى وقت الامتحان', 403);
  const attemptCount = await getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')
    .bind(id, email)
    .first<{ count: number }>();
  if (Number(attemptCount?.count || 0) >= Number(exam.maxAttempts || 3)) {
    return jsonError('انتهى عدد المحاولات المتاحة لهذا الاختبار', 409);
  }
  const payload = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    answers?: Record<string, unknown>;
  };
  const sessionId = safeText(payload.sessionId, 100);
  if (!sessionId) return jsonError('جلسة الامتحان مطلوبة', 400);
  const session = await getDatabase()
    .prepare(
      `SELECT id, started_at AS startedAt, expires_at AS expiresAt, status
       FROM exam_sessions WHERE id = ? AND exam_id = ? AND user_email = ?`
    )
    .bind(sessionId, id, email)
    .first<{ id: string; startedAt: number; expiresAt: number; status: string }>();
  if (!session || session.status !== 'active')
    return jsonError('جلسة الامتحان غير صالحة، افتح الامتحان من حسابك', 409);
  if (now >= Number(session.expiresAt)) return jsonError('انتهى وقت الامتحان', 408);
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const questionResult = await getDatabase()
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options, correct_answer AS correctAnswer,
       rubric, points FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(id)
    .all<QuestionRow>();
  if (!questionResult.results.length) return jsonError('لا توجد أسئلة في هذا الامتحان', 409);

  const objective: Array<{
    question: QuestionRow;
    answer: string;
    score: number;
    feedback: string;
  }> = [];
  const writtenInputs: WrittenGradingInput[] = [];
  for (const question of questionResult.results) {
    const answer = safeText(answers[question.id], 5000);
    if (question.type === 'short_answer') {
      writtenInputs.push({
        questionId: question.id,
        prompt: question.prompt,
        answer,
        correctAnswer: question.correctAnswer,
        rubric: question.rubric,
        points: question.points,
      });
    } else {
      const correct =
        answer.trim().toLocaleLowerCase('en') ===
        question.correctAnswer.trim().toLocaleLowerCase('en');
      objective.push({
        question,
        answer,
        score: correct ? question.points : 0,
        feedback: correct ? 'إجابة صحيحة.' : `الإجابة الصحيحة: ${question.correctAnswer}`,
      });
    }
  }
  const written = await gradeWrittenAnswers(writtenInputs);
  const writtenById = new Map(written.grades.map((grade) => [grade.questionId, grade]));
  const allAnswers = questionResult.results.map((question) => {
    const objectiveGrade = objective.find((item) => item.question.id === question.id);
    const writtenGrade = writtenById.get(question.id);
    return {
      question,
      answer: safeText(answers[question.id], 5000),
      score: objectiveGrade?.score ?? writtenGrade?.score ?? 0,
      feedback: objectiveGrade?.feedback ?? writtenGrade?.feedback ?? '',
    };
  });
  const score = allAnswers.reduce((total, item) => total + item.score, 0);
  const maxScore = questionResult.results.reduce((total, question) => total + question.points, 0);
  const percentage = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const submittedAt = Date.now();
  const claimedSession = await claimExamSession(getDatabase(), sessionId, id, email, submittedAt);
  if (!claimedSession) return jsonError('جلسة الامتحان انتهت أو تم تسليمها', 409);
  const attemptId = crypto.randomUUID();
  const startedAt = Number(claimedSession.startedAt);
  const feedback =
    percentage >= Number(exam.passingScore || 50)
      ? 'أداء ممتاز، استمر على نفس المستوى.'
      : 'راجع ملاحظات كل سؤال ثم حاول تثبيت النقاط التي فقدتها.';
  const db = getDatabase();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO attempts
         (id, exam_id, user_email, status, score, max_score, feedback, grading_method, started_at, submitted_at)
         VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`
        )
        .bind(attemptId, id, email, score, maxScore, feedback, written.method, startedAt, submittedAt),
      ...allAnswers.map((item) =>
        db
          .prepare(
            'INSERT INTO answers (id, attempt_id, question_id, answer, score, feedback) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(
            crypto.randomUUID(),
            attemptId,
            item.question.id,
            item.answer,
            item.score,
            item.feedback
          )
      ),
      db
        .prepare("UPDATE exam_sessions SET status = 'submitted' WHERE id = ? AND status = 'submitting'")
        .bind(claimedSession.id),
    ]);
  } catch (error) {
    await releaseExamSessionClaim(db, claimedSession.id).catch(() => {});
    throw error;
  }
  invalidateLeaderboardCache();
  return Response.json({
    attemptId,
    score,
    maxScore,
    percentage,
    passed: percentage >= Number(exam.passingScore || 50),
    feedback,
    gradingMethod: writtenInputs.length ? written.method : 'rules',
    answers: allAnswers.map((item) => ({
      questionId: item.question.id,
      score: item.score,
      points: item.question.points,
      feedback: item.feedback,
    })),
  });
}
