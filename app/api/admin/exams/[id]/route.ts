import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase, getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';
import { recordAuditLog } from '../../../../lib/audit';
import { captureException } from '../../../../lib/observability';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const db = getDatabase();
  const exam = await db
    .prepare(
      `SELECT id, course_id AS courseId, title, description, instructions,
     duration_minutes AS durationMinutes, passing_score AS passingScore, max_attempts AS maxAttempts, status,
     opens_at AS opensAt, closes_at AS closesAt,
     COALESCE(assessment_type, 'exam') AS assessmentType,
     COALESCE(mode, 'online') AS mode,
     CASE WHEN teacher_file_key IS NOT NULL THEN 1 ELSE 0 END AS hasTeacherFile
     FROM exams WHERE id = ?`
    )
    .bind(id)
    .first();
  if (!exam) return jsonError('الامتحان غير موجود', 404);
  const questions = await db
    .prepare(
      `SELECT id, sort_order AS sortOrder, type, prompt, options,
     correct_answer AS correctAnswer, rubric, explanation, points
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
  const db = getDatabase();
  const existing = await db
    .prepare(
      `SELECT course_id AS courseId, title, description, instructions, duration_minutes AS durationMinutes,
     passing_score AS passingScore, max_attempts AS maxAttempts, status, opens_at AS opensAt, closes_at AS closesAt,
     COALESCE(assessment_type, 'exam') AS assessmentType,
     COALESCE(mode, 'online') AS mode
     FROM exams WHERE id = ?`
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError('الامتحان غير موجود', 404);
  const status = body.status === 'published' ? 'published' : 'draft';
  const assessmentType = body.assessmentType === 'quiz' ? 'quiz' : 'exam';
  const mode = body.mode === 'file' ? 'file' : 'online';
  const nullableTimestamp = (value: unknown, fallback: unknown) => {
    if (value === null) return null;
    const candidate = value === undefined ? fallback : value;
    if (candidate === null || candidate === undefined || candidate === '') return null;
    const number = Number(candidate);
    return Number.isFinite(number) ? number : null;
  };
  const updateStmt = db
    .prepare(
      `UPDATE exams SET title = ?, description = ?, instructions = ?, course_id = ?,
     duration_minutes = ?, passing_score = ?, max_attempts = ?, status = ?, opens_at = ?, closes_at = ?,
     assessment_type = ?, mode = ?, updated_at = ?
     WHERE id = ?`
    )
    .bind(
      safeText(body.title ?? existing.title, 150),
      safeText(body.description ?? existing.description, 1200),
      safeText(body.instructions ?? existing.instructions, 2000),
      body.courseId === null ? null : safeText(body.courseId ?? existing.courseId, 80) || null,
      safeInteger(body.durationMinutes ?? existing.durationMinutes, 30, 1, 300),
      safeInteger(body.passingScore ?? existing.passingScore, 50, 0, 100),
      safeInteger(body.maxAttempts ?? existing.maxAttempts, 3, 1, 10),
      status,
      nullableTimestamp(body.opensAt, existing.opensAt),
      nullableTimestamp(body.closesAt, existing.closesAt),
      body.assessmentType ? assessmentType : (existing.assessmentType as string) || 'exam',
      body.mode ? mode : (existing.mode as string) || 'online',
      Date.now(),
      id
    );

  // Optionally replace questions if provided
  if (Array.isArray(body.questions) && body.questions.length > 0) {
    const hasAttempts = await db
      .prepare('SELECT id FROM attempts WHERE exam_id = ? LIMIT 1')
      .bind(id)
      .first();
    if (hasAttempts) {
      return jsonError('لا يمكن تعديل أسئلة امتحان له نتائج محفوظة. يمكنك إنشاء امتحان جديد.', 409);
    }
    type RawQuestion = Record<string, unknown>;
    const newQuestions = (body.questions as RawQuestion[]).slice(0, 100).map((q, idx) => {
      const type = ['multiple_choice', 'true_false', 'short_answer'].includes(String(q.type))
        ? String(q.type)
        : 'multiple_choice';
      const options = Array.isArray(q.options)
        ? q.options
            .map((o) => safeText(o, 300))
            .filter(Boolean)
            .slice(0, 8)
        : [];
      return {
        id: crypto.randomUUID(),
        sortOrder: idx + 1,
        type,
        prompt: safeText(q.prompt, 2000),
        options: JSON.stringify(options),
        correctAnswer: safeText(q.correctAnswer, 1000),
        rubric: safeText(q.rubric, 2000),
        explanation: safeText(q.explanation, 5000),
        points: safeInteger(q.points, 1, 1, 100),
      };
    });
    if (newQuestions.some((q) => !q.prompt || !q.correctAnswer)) {
      return jsonError('كل سؤال يحتاج نص وإجابة صحيحة');
    }
    const oldIds = await db
      .prepare('SELECT id FROM questions WHERE exam_id = ?')
      .bind(id)
      .all<{ id: string }>();
    await db.batch([
      updateStmt,
      ...oldIds.results.map((q) => db.prepare('DELETE FROM questions WHERE id = ?').bind(q.id)),
      ...newQuestions.map((q) =>
        db
          .prepare(
            `INSERT INTO questions (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, explanation, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            q.id,
            id,
            q.sortOrder,
            q.type,
            q.prompt,
            q.options,
            q.correctAnswer,
            q.rubric,
            q.explanation,
            q.points
          )
      ),
    ]);
  } else {
    await updateStmt.run();
  }
  await db
    .prepare(
      "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?"
    )
    .bind(id)
    .run();
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

  const exam = await db
    .prepare('SELECT id, title, teacher_file_key AS teacherFileKey FROM exams WHERE id = ?')
    .bind(id)
    .first<{ id: string; title: string; teacherFileKey?: string | null }>();
  if (!exam) return jsonError('الامتحان غير موجود', 404);

  // Collect storage file keys to clean up after successful DB commit
  const filesToDelete = new Set<string>();
  if (exam.teacherFileKey) {
    filesToDelete.add(exam.teacherFileKey);
  }

  const [questions, attempts] = await Promise.all([
    db
      .prepare('SELECT id, image_file_key AS imageFileKey FROM questions WHERE exam_id = ?')
      .bind(id)
      .all<{ id: string; imageFileKey?: string | null }>()
      .catch(() => ({ results: [] as { id: string; imageFileKey?: string | null }[] })),
    db
      .prepare('SELECT id, pdf_storage_key AS pdfStorageKey FROM attempts WHERE exam_id = ?')
      .bind(id)
      .all<{ id: string; pdfStorageKey?: string | null }>()
      .catch(() => ({ results: [] as { id: string; pdfStorageKey?: string | null }[] })),
  ]);

  for (const q of questions.results) {
    if (q.imageFileKey) filesToDelete.add(q.imageFileKey);
  }
  for (const a of attempts.results) {
    if (a.pdfStorageKey) filesToDelete.add(a.pdfStorageKey);
  }

  try {
    await db.batch([
      // 1. Unlink prerequisite on any videos gating on this exam
      db
        .prepare('UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id = ?')
        .bind(id),
      // 2. Notification reads
      db
        .prepare("DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?")
        .bind(id),
      // 3. Course items
      db.prepare('DELETE FROM course_items WHERE exam_id = ?').bind(id),
      // 4. Exam sessions
      db.prepare('DELETE FROM exam_sessions WHERE exam_id = ?').bind(id),
      // 5. Answers (attempts or questions)
      db
        .prepare(
          'DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id = ?) OR question_id IN (SELECT id FROM questions WHERE exam_id = ?)'
        )
        .bind(id, id),
      // 6. Attempts
      db.prepare('DELETE FROM attempts WHERE exam_id = ?').bind(id),
      // 7. Questions
      db.prepare('DELETE FROM questions WHERE exam_id = ?').bind(id),
      // 8. Exam itself
      db.prepare('DELETE FROM exams WHERE id = ?').bind(id),
    ]);
  } catch (error) {
    captureException(error, { module: 'admin-exam-force-delete', examId: id });
    return jsonError('فشل حذف الامتحان وبياناته التابعة.', 500);
  }

  // Best-effort storage cleanup after successful DB commit
  const storage = getPrivateStorage();
  for (const key of filesToDelete) {
    try {
      await storage.delete(key);
    } catch (storageError) {
      captureException(storageError, { module: 'exam-delete-storage', storageKey: key, examId: id });
    }
  }

  await recordAuditLog({
    userEmail: admin.email,
    action: 'exam.force_deleted',
    resource: 'exam',
    resourceId: id,
    details: { title: exam.title },
    request,
  });

  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}
