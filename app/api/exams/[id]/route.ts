import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { examAvailabilityError, loadStudentExam } from '../../../lib/exam-access';
import { gradeWrittenAnswers, type WrittenGradingInput } from '../../../lib/grading';
import { claimExamSession, releaseExamSessionClaim } from '../../../lib/exam-session';
import { getDatabase } from '../../../lib/platform';
import { getPrivateStorage } from '../../../lib/private-storage';
import { invalidateLeaderboardCache } from '../../../lib/leaderboard-cache';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import {
  jsonError,
  requestBodyWithinLimit,
  requireSameOrigin,
  safeText,
} from '../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_PDF_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../lib/upload-validation';
import { hasCourseItems, getCourseSequenceUnlockState } from '../../../lib/course-sequence';

type QuestionRow = {
  id: string;
  type: string;
  prompt: string;
  options: string | null;
  correctAnswer: string;
  rubric: string;
  explanation: string;
  points: number;
  sortOrder: number;
};

async function assertExamUnlocked(
  examId: string,
  courseId: string | null,
  email: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!courseId) return { ok: true };
  const courseHasSequence = await hasCourseItems(courseId);
  if (!courseHasSequence) return { ok: true };
  const unlockState = await getCourseSequenceUnlockState(courseId, email);
  const key = `exam:${examId}`;
  const state = unlockState.get(key);
  if (state && !state.unlocked) {
    return {
      ok: false,
      status: 403,
      error: 'يجب إكمال العناصر السابقة في تسلسل التعلم أولاً',
    };
  }
  return { ok: true };
}

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

  const sequenceCheck = await assertExamUnlocked(id, exam.courseId, email);
  if (!sequenceCheck.ok) return jsonError(sequenceCheck.error!, sequenceCheck.status!);

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
      `SELECT id, sort_order AS sortOrder, type, prompt, options, points,
              image_file_key AS imageFileKey
       FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(id)
    .all();
  return Response.json({
    exam,
    session,
    questions: result.results.map((question) => ({
      id: question.id,
      sortOrder: question.sortOrder,
      type: question.type,
      prompt: question.prompt,
      options: question.options ? JSON.parse(String(question.options)) : [],
      points: question.points,
      hasImage: question.imageFileKey != null,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
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

  const sequenceCheck = await assertExamUnlocked(id, exam.courseId, email);
  if (!sequenceCheck.ok) return jsonError(sequenceCheck.error!, sequenceCheck.status!);

  const attemptCount = await getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')
    .bind(id, email)
    .first<{ count: number }>();
  if (Number(attemptCount?.count || 0) >= Number(exam.maxAttempts || 3)) {
    return jsonError('انتهى عدد المحاولات المتاحة لهذا الاختبار', 409);
  }

  const db = getDatabase();
  const examRow = await db
    .prepare('SELECT COALESCE(mode, \'online\') AS mode FROM exams WHERE id = ?')
    .bind(id)
    .first<{ mode: string }>();
  const examMode = examRow?.mode || 'online';

  let sessionId: string;
  let answers: Record<string, unknown> = {};
  let pdfStorageKey: string | null = null;

  if (examMode === 'file') {
    const contentType = request.headers.get('content-type') || '';
    const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
    if (normalizedContentType !== 'multipart/form-data') {
      return jsonError('يجب رفع ملف PDF مع بيانات الجلسة', 400);
    }
    if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
      return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
    }
    const formData = await request.formData().catch(() => null);
    if (!formData) return jsonError('تعذر قراءة البيانات', 400);
    sessionId = safeText(formData.get('sessionId'), 100);
    if (!sessionId) return jsonError('جلسة الامتحان مطلوبة', 400);
    const answersRaw = formData.get('answers');
    if (typeof answersRaw === 'string') {
      try { answers = JSON.parse(answersRaw); } catch { answers = {}; }
    }
    const file = formData.get('file');
    if (!(file instanceof Blob)) return jsonError('يجب رفع ملف PDF', 400);
    const fileBytes = await file.arrayBuffer();
    if (fileBytes.byteLength > MAX_PDF_SIZE) {
      return jsonError('حجم الملف يتجاوز الحد الأقصى (15 ميجابايت)', 400);
    }
    if (!isPdfUpload(file.type || 'application/pdf', fileBytes)) {
      return jsonError('يجب رفع ملف PDF صالح فقط', 400);
    }
    const storage = getPrivateStorage();
    const attemptId = crypto.randomUUID();
    const fileKey = `exams/${id}/submissions/${email}-${attemptId}.pdf`;
    await storage.put(fileKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { uploadedBy: email },
    });
    pdfStorageKey = fileKey;
  } else {
    if (!requestBodyWithinLimit(request, 768 * 1024)) {
      return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
    }
    const payload = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      answers?: Record<string, unknown>;
    };
    sessionId = safeText(payload.sessionId, 100);
    if (!sessionId) return jsonError('جلسة الامتحان مطلوبة', 400);
    answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  }

  const session = await db
    .prepare(
      `SELECT id, started_at AS startedAt, expires_at AS expiresAt, status
       FROM exam_sessions WHERE id = ? AND exam_id = ? AND user_email = ?`
    )
    .bind(sessionId!, id, email)
    .first<{ id: string; startedAt: number; expiresAt: number; status: string }>();
  if (!session || session.status !== 'active')
    return jsonError('جلسة الامتحان غير صالحة، افتح الامتحان من حسابك', 409);
  if (now >= Number(session.expiresAt)) return jsonError('انتهى وقت الامتحان', 408);

  const questionResult = await db
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options, correct_answer AS correctAnswer,
       rubric, explanation, points FROM questions WHERE exam_id = ? ORDER BY sort_order`
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
  const claimedSession = await claimExamSession(db, sessionId!, id, email, submittedAt);
  if (!claimedSession) return jsonError('جلسة الامتحان انتهت أو تم تسليمها', 409);
  const attemptId = crypto.randomUUID();
  const startedAt = Number(claimedSession.startedAt);
  const feedback =
    percentage >= Number(exam.passingScore || 50)
      ? 'أداء ممتاز، استمر على نفس المستوى.'
      : 'راجع ملاحظات كل سؤال ثم حاول تثبيت النقاط التي فقدتها.';
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO attempts
         (id, exam_id, user_email, status, score, max_score, feedback, grading_method, started_at, submitted_at, pdf_storage_key)
         VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(attemptId, id, email, score, maxScore, feedback, written.method, startedAt, submittedAt, pdfStorageKey),
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
      explanation: item.question.explanation || '',
    })),
  });
}
