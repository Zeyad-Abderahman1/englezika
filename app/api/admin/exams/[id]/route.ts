import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';
import { recordAuditLog } from '../../../../lib/audit';
import { assessmentService } from '../../../../lib/services/assessment-service';
import { parseQuestion, validateQuestion, type RawQuestion } from '../../../../lib/exam-validation';

function nullableTimestamp(val: unknown, fallback: unknown) {
  if (val === null) return null;
  if (val === undefined) return fallback ? Number(fallback) : null;
  const num = Number(val);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;

  const db = getDatabase();
  const exam = await db
    .prepare(
      `SELECT id, course_id AS courseId, title, description, instructions,
     duration_minutes AS durationMinutes, passing_score AS passingScore, max_attempts AS maxAttempts, status,
     scope_type AS scopeType, from_video_id AS fromVideoId, to_video_id AS toVideoId,
     coverage_start_lecture_id AS coverageStartLectureId, coverage_end_lecture_id AS coverageEndLectureId,
     COALESCE(assessment_type, 'exam') AS assessmentType,
     COALESCE(mode, 'online') AS mode,
     CASE WHEN teacher_file_key IS NOT NULL THEN 1 ELSE 0 END AS hasTeacherFile,
     opens_at AS opensAt, closes_at AS closesAt FROM exams WHERE id = ?`
    )
    .bind(id)
    .first();
  if (!exam) return jsonError('الامتحان غير موجود', 404);
  const questions = await db
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options,
     correct_answer AS correctAnswer, rubric, points
     FROM questions WHERE exam_id = ? ORDER BY sort_order`
    )
    .bind(id)
    .all();
  return Response.json({
    exam,
    questions: questions.results.map((question) => ({
      ...question,
      options: question.options ? JSON.parse(String(question.options)) : [],
    })),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  const assessmentType = body.assessmentType === 'quiz' ? 'quiz' : 'exam';
  const mode = body.mode === 'file' ? 'file' : 'online';

  const db = getDatabase();
  const existing = await db
    .prepare(
      `SELECT course_id AS courseId, title, description, instructions, duration_minutes AS durationMinutes,
     passing_score AS passingScore, max_attempts AS maxAttempts, status, opens_at AS opensAt, closes_at AS closesAt,
     scope_type AS scopeType, from_video_id AS fromVideoId, to_video_id AS toVideoId,
     coverage_start_lecture_id AS coverageStartLectureId, coverage_end_lecture_id AS coverageEndLectureId,
     assessment_type AS assessmentType, mode
     FROM exams WHERE id = ?`
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError('الامتحان غير موجود', 404);

  const status = body.status === 'published' ? 'published' : 'draft';
  const scopeType =
    body.scopeType === 'lecture_range' || body.scopeType === 'all_lectures'
      ? String(body.scopeType)
      : (existing.scopeType as string) || 'all_lectures';

  const courseId =
    body.courseId === null
      ? null
      : safeText(body.courseId ?? existing.courseId, 80) || null;

  const fromVideoId =
    body.fromVideoId === null
      ? null
      : safeText(body.fromVideoId ?? existing.fromVideoId, 80) || null;

  const toVideoId =
    body.toVideoId === null
      ? null
      : safeText(body.toVideoId ?? existing.toVideoId, 80) || null;

  const coverageStartLectureId =
    body.coverageStartLectureId === null
      ? null
      : safeText(body.coverageStartLectureId ?? existing.coverageStartLectureId, 80) || null;

  const coverageEndLectureId =
    body.coverageEndLectureId === null
      ? null
      : safeText(body.coverageEndLectureId ?? existing.coverageEndLectureId, 80) || null;

  const passingScore = safeInteger(body.passingScore ?? existing.passingScore, 50, 0, 100);

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
    if (vTo.prerequisite_exam_id && vTo.prerequisite_exam_id !== id) {
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

  const updateStmt = db
    .prepare(
      `UPDATE exams SET
     title = ?, description = ?, instructions = ?, course_id = ?,
     duration_minutes = ?, passing_score = ?, max_attempts = ?, status = ?,
     scope_type = ?, from_video_id = ?, to_video_id = ?,
     coverage_start_lecture_id = ?, coverage_end_lecture_id = ?,
     assessment_type = ?, mode = ?,
     opens_at = ?, closes_at = ?, updated_at = ?
     WHERE id = ?`
    )
    .bind(
      safeText(body.title ?? existing.title, 150),
      safeText(body.description ?? existing.description, 1200),
      safeText(body.instructions ?? existing.instructions, 2000),
      courseId,
      safeInteger(body.durationMinutes ?? existing.durationMinutes, 30, 1, 300),
      passingScore,
      safeInteger(body.maxAttempts ?? existing.maxAttempts, 3, 1, 10),
      status,
      scopeType,
      fromVideoId,
      toVideoId,
      coverageStartLectureId,
      coverageEndLectureId,
      body.assessmentType !== undefined ? assessmentType : String(existing.assessmentType ?? 'exam'),
      body.mode !== undefined ? mode : String(existing.mode ?? 'online'),
      nullableTimestamp(body.opensAt, existing.opensAt),
      nullableTimestamp(body.closesAt, existing.closesAt),
      Date.now(),
      id
    );

  const statements = [updateStmt];

  // If exam status is NOT published, or scope is not lecture_range, or target to_video_id changed:
  // Clear any existing prerequisite link on videos
  const oldToVideoId = existing.toVideoId as string | null;
  if (status !== 'published' || scopeType !== 'lecture_range' || oldToVideoId !== toVideoId) {
    statements.push(
      db
        .prepare(
          'UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id = ?'
        )
        .bind(id)
    );
  }

  // Only bind prerequisite if status is published AND scope is lecture_range
  if (status === 'published' && scopeType === 'lecture_range' && toVideoId && courseId) {
    statements.push(
      db
        .prepare(
          'UPDATE videos SET prerequisite_exam_id = ?, minimum_score = ? WHERE id = ? AND course_id = ?'
        )
        .bind(id, passingScore, toVideoId, courseId)
    );
  }

  // Optionally replace questions if provided
  if (Array.isArray(body.questions) && body.questions.length > 0) {
    const hasAttempts = await db
      .prepare('SELECT id FROM attempts WHERE exam_id = ? LIMIT 1')
      .bind(id)
      .first();
    if (hasAttempts) {
      return jsonError('لا يمكن تعديل أسئلة امتحان له نتائج محفوظة. يمكنك إنشاء امتحان جديد.', 409);
    }
    const newQuestions = (body.questions as RawQuestion[])
      .slice(0, 100)
      .map((q, idx) => parseQuestion(q, idx + 1));
    for (const q of newQuestions) {
      const qErr = validateQuestion(q);
      if (qErr) {
        return jsonError(qErr, 400);
      }
    }
    const oldIds = await db
      .prepare('SELECT id FROM questions WHERE exam_id = ?')
      .bind(id)
      .all<{ id: string }>();

    statements.push(
      ...oldIds.results.map((q) => db.prepare('DELETE FROM questions WHERE id = ?').bind(q.id)),
      ...newQuestions.map((q) =>
        db
          .prepare(
            `INSERT INTO questions (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            id,
            q.sortOrder,
            q.type,
            q.prompt,
            JSON.stringify(q.options),
            q.correctAnswer,
            q.rubric,
            q.points
          )
      )
    );
  }

  await db.batch(statements);

  // Clear unread notification markers for this exam
  await db
    .prepare(
      "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?"
    )
    .bind(id)
    .run();

  await recordAuditLog({
    userEmail: admin.email,
    action: 'exam_update',
    resource: 'exams',
    resourceId: id,
    request,
    details: {
      scopeType,
      fromVideoId,
      toVideoId,
      passingScore,
      assessmentType,
      mode,
    },
  });

  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;

  const db = getDatabase();
  const attempt = await db
    .prepare('SELECT id FROM attempts WHERE exam_id = ? LIMIT 1')
    .bind(id)
    .first();
  if (attempt) return jsonError('لا يمكن حذف امتحان له نتائج؛ يمكنك تحويله إلى مسودة', 409);

  // Clear prerequisite gate on videos
  await db
    .prepare(
      'UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id = ?'
    )
    .bind(id)
    .run();

  // assessmentService.deleteExam cascades DB and cleans up storage for:
  // - teacherFileKey / teacher_file_key
  // - imageFileKey / image_file_key
  // - pdfStorageKey / pdf_storage_key
  try {
    const result = await assessmentService.deleteExam(id, admin, { request });
    invalidatePublicCourseCache();
    return Response.json(result);
  } catch {
    const questionIds = await db
      .prepare('SELECT id FROM questions WHERE exam_id = ?')
      .bind(id)
      .all<{ id: string }>();
    await db.batch([
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?"
        )
        .bind(id),
      ...questionIds.results.map((question) =>
        db.prepare('DELETE FROM questions WHERE id = ?').bind(question.id)
      ),
      db.prepare('DELETE FROM exams WHERE id = ?').bind(id),
    ]);
    invalidatePublicCourseCache();
    return Response.json({ ok: true });
  }
}
