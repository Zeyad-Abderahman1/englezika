import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getDatabase } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';
import { invalidatePublicCourseCache } from '../../../lib/public-course-cache';

type RawQuestion = Record<string, unknown>;

function parseQuestion(question: RawQuestion, sortOrder: number) {
  const type = 'multiple_choice';
  const prompt = safeText(question.prompt, 2000);
  const correctAnswer = safeText(question.correctAnswer, 1000);
  const rubric = safeText(question.rubric, 2000);
  const points = safeInteger(question.points, 1, 1, 100);
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => safeText(option, 300))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { type, prompt, correctAnswer, rubric, points, options, sortOrder };
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title, 150);
  const description = safeText(body.description, 1200);
  const instructions = safeText(body.instructions, 2000);
  const courseId = safeText(body.courseId, 80) || null;
  const durationMinutes = safeInteger(body.durationMinutes, 30, 1, 300);
  const passingScore = safeInteger(body.passingScore, 50, 0, 100);
  const maxAttempts = safeInteger(body.maxAttempts, 3, 1, 10);
  const status = body.status === 'published' ? 'published' : 'draft';
  const questions = Array.isArray(body.questions)
    ? body.questions
        .slice(0, 100)
        .map((question, index) => parseQuestion(question as RawQuestion, index + 1))
    : [];
  if (title.length < 3) return jsonError('اسم الامتحان مطلوب');
  if (
    !questions.length ||
    questions.some((question) => !question.prompt || !question.correctAnswer)
  ) {
    return jsonError('أضف سؤالاً واحداً على الأقل مع الإجابة الصحيحة');
  }
  if (
    questions.some((question) => question.type === 'multiple_choice' && question.options.length < 2)
  ) {
    return jsonError('كل سؤال اختيار من متعدد يحتاج اختيارين على الأقل');
  }
  if (questions.some((question) => !question.options.includes(question.correctAnswer))) {
    return jsonError('اختر الإجابة الصحيحة من اختيارات السؤال');
  }
  const db = getDatabase();
  if (courseId) {
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) return jsonError('الكورس المحدد غير موجود', 404);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO exams
       (id, course_id, title, description, instructions, duration_minutes, passing_score, max_attempts,
        status, opens_at, closes_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        courseId,
        title,
        description,
        instructions,
        durationMinutes,
        passingScore,
        maxAttempts,
        status,
        body.opensAt ? Number(body.opensAt) : null,
        body.closesAt ? Number(body.closesAt) : null,
        admin.email.toLowerCase(),
        now,
        now
      ),
    ...questions.map((question) =>
      db
        .prepare(
          `INSERT INTO questions
       (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          id,
          question.sortOrder,
          question.type,
          question.prompt,
          JSON.stringify(question.options),
          question.correctAnswer,
          question.rubric,
          question.points
        )
    ),
  ]);
  invalidatePublicCourseCache();
  return Response.json({ ok: true, id });
}
