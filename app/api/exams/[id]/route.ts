import { ensureDatabase } from '../../../../db/runtime';
import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { gradeWrittenAnswers, type WrittenGradingInput } from '../../../lib/grading';
import { getD1 } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../lib/security';

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

async function loadExam(id: string, email: string) {
  const db = getD1();
  const exam = await db
    .prepare(
      `SELECT x.id, x.course_id AS courseId, x.title, x.description, x.instructions,
     x.duration_minutes AS durationMinutes, x.passing_score AS passingScore,
     x.max_attempts AS maxAttempts,
     x.opens_at AS opensAt, x.closes_at AS closesAt
     FROM exams x LEFT JOIN enrollments e
     ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
     WHERE x.id = ? AND x.status = 'published' AND (x.course_id IS NULL OR e.id IS NOT NULL)`
    )
    .bind(email, id)
    .first<Record<string, unknown>>();
  return exam;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  await ensureDatabase();
  const { id } = await params;
  const exam = await loadExam(id, user.email.toLowerCase());
  if (!exam) return jsonError('الامتحان غير متاح لحسابك', 404);
  const now = Date.now();
  if (exam.opensAt && Number(exam.opensAt) > now) return jsonError('الامتحان لم يبدأ بعد', 403);
  if (exam.closesAt && Number(exam.closesAt) < now)
    return jsonError('انتهى وقت إتاحة الامتحان', 403);
  const email = user.email.toLowerCase();
  const attemptCount = await getD1()
    .prepare('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')
    .bind(id, email)
    .first<{ count: number }>();
  if (Number(attemptCount?.count || 0) >= Number(exam.maxAttempts || 3)) {
    return jsonError('انتهى عدد المحاولات المتاحة لهذا الاختبار', 409);
  }
  const result = await getD1()
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options, points
     FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(id)
    .all();
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();
  const expiresAt = startedAt + Number(exam.durationMinutes || 30) * 60_000;
  await getD1()
    .prepare(
      `INSERT INTO exam_sessions (id, exam_id, user_email, started_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, 'active')
     ON CONFLICT(exam_id, user_email) DO UPDATE SET id = excluded.id,
     started_at = excluded.started_at, expires_at = excluded.expires_at, status = 'active'`
    )
    .bind(sessionId, id, email, startedAt, expiresAt)
    .run();
  const session = await getD1()
    .prepare(
      'SELECT id, started_at AS startedAt, expires_at AS expiresAt, status FROM exam_sessions WHERE exam_id = ? AND user_email = ?'
    )
    .bind(id, email)
    .first();
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
  await ensureDatabase();
  const { id } = await params;
  const email = user.email.toLowerCase();
  const exam = await loadExam(id, email);
  if (!exam) return jsonError('الامتحان غير متاح لحسابك', 404);
  const now = Date.now();
  if (exam.opensAt && Number(exam.opensAt) > now) return jsonError('الامتحان لم يبدأ بعد', 403);
  if (exam.closesAt && Number(exam.closesAt) < now) return jsonError('انتهى وقت الامتحان', 403);
  const attemptCount = await getD1()
    .prepare('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')
    .bind(id, email)
    .first<{ count: number }>();
  if (Number(attemptCount?.count || 0) >= Number(exam.maxAttempts || 3)) {
    return jsonError('انتهى عدد المحاولات المتاحة لهذا الاختبار', 409);
  }
  const session = await getD1()
    .prepare(
      'SELECT id, started_at AS startedAt, expires_at AS expiresAt, status FROM exam_sessions WHERE exam_id = ? AND user_email = ?'
    )
    .bind(id, email)
    .first<{ id: string; startedAt: number; expiresAt: number; status: string }>();
  if (!session || session.status !== 'active')
    return jsonError('جلسة الامتحان غير صالحة، افتح الامتحان من حسابك', 409);
  if (now > Number(session.expiresAt) + 120_000) return jsonError('انتهى وقت الامتحان', 408);
  const payload = (await request.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const questionResult = await getD1()
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
  const attemptId = crypto.randomUUID();
  const startedAt = Number(session.startedAt);
  const feedback =
    percentage >= Number(exam.passingScore || 50)
      ? 'أداء ممتاز، استمر على نفس المستوى.'
      : 'راجع ملاحظات كل سؤال ثم حاول تثبيت النقاط التي فقدتها.';
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO attempts
       (id, exam_id, user_email, status, score, max_score, feedback, grading_method, started_at, submitted_at)
       VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`
      )
      .bind(attemptId, id, email, score, maxScore, feedback, written.method, startedAt, now),
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
    db.prepare("UPDATE exam_sessions SET status = 'submitted' WHERE id = ?").bind(session.id),
  ]);
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
