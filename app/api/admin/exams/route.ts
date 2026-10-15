import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getDatabase } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';
import { invalidatePublicCourseCache } from '../../../lib/public-course-cache';
import { recordAuditLog } from '../../../lib/audit';
import { parseQuestion, validateQuestion, type RawQuestion } from '../../../lib/exam-validation';

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
  const assessmentType = body.assessmentType === 'quiz' ? 'quiz' : 'exam';
  const mode = body.mode === 'file' ? 'file' : 'online';
  const scopeType = body.scopeType === 'lecture_range' ? 'lecture_range' : 'all_lectures';
  const fromVideoId = safeText(body.fromVideoId, 80) || null;
  const toVideoId = safeText(body.toVideoId, 80) || null;
  const coverageStartLectureId = safeText(body.coverageStartLectureId, 80) || null;
  const coverageEndLectureId = safeText(body.coverageEndLectureId, 80) || null;
  const showReview = body.showReview !== false && body.show_review !== false;

  const questions =
    mode === 'online' && Array.isArray(body.questions)
      ? body.questions
          .slice(0, 100)
          .map((question, index) => parseQuestion(question as RawQuestion, index + 1))
      : [];

  if (title.length < 3) return jsonError('اسم الامتحان مطلوب');
  if (mode === 'online') {
    if (!questions.length) {
      return jsonError('أضف سؤالاً واحداً على الأقل مع الإجابة الصحيحة');
    }
    for (const question of questions) {
      const questionError = validateQuestion(question);
      if (questionError) {
        return jsonError(questionError, 400);
      }
    }
  }

  const db = getDatabase();
  if (courseId) {
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) return jsonError('الكورس المحدد غير موجود', 404);
  }

  if (scopeType === 'lecture_range') {
    if (!courseId) {
      return jsonError('يجب اختيار كورس عند تحديد نطاق محاضرات للاختبار', 400);
    }
    if (!fromVideoId || !toVideoId) {
      return jsonError('يجب تحديد المحاضرة الأولى والمحاضرة التالية لنطاق الاختبار', 400);
    }
    if (fromVideoId === toVideoId) {
      return jsonError('لا يمكن أن تبدأ وتنتهي بوابة الاختبار عند نفس المحاضرة', 400);
    }

    const vFrom = await db
      .prepare('SELECT id, course_id, created_at FROM videos WHERE id = ? AND course_id = ?')
      .bind(fromVideoId, courseId)
      .first<{ id: string; course_id: string; created_at: number }>();
    if (!vFrom) return jsonError('المحاضرة الأولى غير صالحة لهذا الكورس', 400);

    const vTo = await db
      .prepare('SELECT id, course_id, created_at, prerequisite_exam_id FROM videos WHERE id = ? AND course_id = ?')
      .bind(toVideoId, courseId)
      .first<{ id: string; course_id: string; created_at: number; prerequisite_exam_id: string | null }>();
    if (!vTo) return jsonError('المحاضرة التالية غير صالحة لهذا الكورس', 400);

    // Validate sequential order: from lecture must precede to lecture
    if (vFrom.created_at >= vTo.created_at) {
      return jsonError('يجب أن تسبق المحاضرة الأولى المحاضرة التالية في الترتيب الزمني للكورس', 400);
    }

    // Check if target video already has a different prerequisite_exam_id
    if (vTo.prerequisite_exam_id) {
      const confirmOverride = Boolean(body.confirmOverride || body.overridePrerequisite);
      if (!confirmOverride) {
        return Response.json(
          {
            ok: false,
            error: 'المحاضرة المستهدفة مرتبطة بالفعل باختبار إجباري آخر. هل ترغب في استبداله؟',
            code: 'PREREQUISITE_CONFLICT',
            existingPrerequisiteExamId: vTo.prerequisite_exam_id,
          },
          { status: 409 }
        );
      }
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  const statements = [
    db
      .prepare(
        `INSERT INTO exams
       (id, course_id, title, description, instructions, duration_minutes, passing_score, max_attempts,
        status, opens_at, closes_at, scope_type, from_video_id, to_video_id, created_by, created_at, updated_at,
        assessment_type, mode, coverage_start_lecture_id, coverage_end_lecture_id, show_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        scopeType,
        fromVideoId,
        toVideoId,
        admin.email.toLowerCase(),
        now,
        now,
        assessmentType,
        mode,
        coverageStartLectureId,
        coverageEndLectureId,
        showReview
      ),
  ];

  if (mode === 'online') {
    statements.push(
      ...questions.map((question) =>
        db
          .prepare(
            `INSERT INTO questions
         (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, points, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            question.points,
            question.explanation || null
          )
      )
    );
  }

  // Only bind prerequisite gate when exam status is published
  if (status === 'published' && scopeType === 'lecture_range' && toVideoId && courseId) {
    statements.push(
      db
        .prepare(
          `UPDATE videos SET prerequisite_exam_id = ?, minimum_score = ? WHERE id = ? AND course_id = ?`
        )
        .bind(id, passingScore, toVideoId, courseId)
    );
  }

  await db.batch(statements);

  await recordAuditLog({
    userEmail: admin.email,
    action: 'exam_create',
    resource: 'exams',
    resourceId: id,
    request,
    details: {
      title,
      courseId,
      scopeType,
      fromVideoId,
      toVideoId,
      passingScore,
      questionCount: questions.length,
      assessmentType,
      mode,
    },
  });

  invalidatePublicCourseCache();
  return Response.json({ ok: true, id });
}
