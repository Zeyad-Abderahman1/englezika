import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase, getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';
import { recordAuditLog } from '../../../../lib/audit';
import { captureException } from '../../../../lib/observability';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title, 120);
  const grade = safeText(body.grade, 80);
  const description = safeText(body.description, 1000);
  const price = safeInteger(body.price, 0, 0, 100_000);
  const status = body.status === 'published' ? 'published' : 'draft';
  if (title.length < 3 || grade.length < 2) return jsonError('بيانات الكورس غير مكتملة');
  const { id } = await params;
  const result = await getDatabase()
    .prepare(
      `UPDATE courses SET title = ?, grade = ?, description = ?, price = ?, status = ?, updated_at = ?
     WHERE id = ?`
    )
    .bind(title, grade, description, price, status, Date.now(), id)
    .run();
  if (result.meta.changes !== 1) return jsonError('الكورس غير موجود', 404);
  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const db = getDatabase();

  const course = await db
    .prepare('SELECT id, title FROM courses WHERE id = ?')
    .bind(id)
    .first<{ id: string; title: string }>();
  if (!course) return jsonError('الكورس غير موجود', 404);

  // Collect any attached files to clean up from storage after successful commit
  const filesToDelete = new Set<string>();

  const [examFiles, questionFiles, attemptFiles, materialFiles, assignmentFiles, subFiles, assignQFiles] =
    await Promise.all([
      db
        .prepare('SELECT teacher_file_key AS key FROM exams WHERE course_id = ? AND teacher_file_key IS NOT NULL')
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare(
          'SELECT image_file_key AS key FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?) AND image_file_key IS NOT NULL'
        )
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare(
          'SELECT pdf_storage_key AS key FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?) AND pdf_storage_key IS NOT NULL'
        )
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare(
          'SELECT file_key AS key FROM lecture_materials WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?) AND file_key IS NOT NULL'
        )
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare('SELECT teacher_file_key AS key FROM assignments WHERE course_id = ? AND teacher_file_key IS NOT NULL')
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare(
          'SELECT pdf_storage_key AS key FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?) AND pdf_storage_key IS NOT NULL'
        )
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
      db
        .prepare(
          'SELECT image_file_key AS key FROM assignment_questions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?) AND image_file_key IS NOT NULL'
        )
        .bind(id)
        .all<{ key: string }>()
        .catch(() => ({ results: [] as { key: string }[] })),
    ]);

  for (const group of [examFiles, questionFiles, attemptFiles, materialFiles, assignmentFiles, subFiles, assignQFiles]) {
    for (const row of group.results) {
      if (row.key) filesToDelete.add(row.key);
    }
  }

  try {
    await db.batch([
      // 1. Course Sequence Items
      db.prepare('DELETE FROM course_items WHERE course_id = ?').bind(id),

      // 2. Exams, Quizzes and dependent assessments
      db
        .prepare(
          'UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id IN (SELECT id FROM exams WHERE course_id = ?)'
        )
        .bind(id),
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id IN (SELECT id FROM exams WHERE course_id = ?)"
        )
        .bind(id),
      db
        .prepare('DELETE FROM exam_sessions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
        .bind(id),
      db
        .prepare(
          `DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?))
           OR question_id IN (SELECT id FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?))`
        )
        .bind(id, id),
      db
        .prepare('DELETE FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
        .bind(id),
      db
        .prepare('DELETE FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
        .bind(id),
      db.prepare('DELETE FROM exams WHERE course_id = ?').bind(id),

      // 3. Videos, Lectures, and dependent records
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'video' AND notification_id IN (SELECT id FROM videos WHERE course_id = ?)"
        )
        .bind(id),
      db
        .prepare('DELETE FROM video_progress WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
        .bind(id),
      db
        .prepare('DELETE FROM video_view_sessions WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
        .bind(id),
      db
        .prepare('DELETE FROM student_video_access_grants WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
        .bind(id),
      db
        .prepare(
          'DELETE FROM lecture_access_codes WHERE course_id = ? OR video_id IN (SELECT id FROM videos WHERE course_id = ?)'
        )
        .bind(id, id),
      db
        .prepare(
          'DELETE FROM access_code_batches WHERE course_id = ? OR video_id IN (SELECT id FROM videos WHERE course_id = ?)'
        )
        .bind(id, id),
      db
        .prepare('DELETE FROM lecture_materials WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
        .bind(id),
      db.prepare('DELETE FROM videos WHERE course_id = ?').bind(id),

      // 4. Assignments and submissions
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id IN (SELECT id FROM assignments WHERE course_id = ?)"
        )
        .bind(id),
      db
        .prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)')
        .bind(id),
      db
        .prepare('DELETE FROM assignment_questions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)')
        .bind(id),
      db.prepare('DELETE FROM assignments WHERE course_id = ?').bind(id),

      // 5. Enrollments (Note: payment_intents are deliberately PRESERVED for financial audit)
      db.prepare('DELETE FROM enrollments WHERE course_id = ?').bind(id),

      // 6. Course-level notification reads
      db
        .prepare("DELETE FROM notification_reads WHERE notification_type = 'course' AND notification_id = ?")
        .bind(id),

      // 7. Course itself
      db.prepare('DELETE FROM courses WHERE id = ?').bind(id),
    ]);
  } catch (error) {
    captureException(error, { module: 'admin-course-force-delete', courseId: id });
    return jsonError('فشل حذف الكورس وبياناته التابعة.', 500);
  }

  // Best-effort storage cleanup after successful DB commit
  const storage = getPrivateStorage();
  for (const key of filesToDelete) {
    try {
      await storage.delete(key);
    } catch (storageError) {
      captureException(storageError, { module: 'course-delete-storage', storageKey: key, courseId: id });
    }
  }

  await recordAuditLog({
    userEmail: admin.email,
    action: 'course.force_deleted',
    resource: 'course',
    resourceId: id,
    details: { title: course.title },
    request,
  });

  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}
