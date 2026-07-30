import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';

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
  const dependencies = await db
    .prepare(
      `SELECT
     (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) +
     (SELECT COUNT(*) FROM exams WHERE course_id = ?) +
     (SELECT COUNT(*) FROM videos WHERE course_id = ?) +
     (SELECT COUNT(*) FROM assignments WHERE course_id = ?) AS count`
    )
    .bind(id, id, id, id)
    .first<{ count: number }>();
  if (Number(dependencies?.count))
    return jsonError('لا يمكن حذف كورس مرتبط بطلاب أو امتحانات أو فيديوهات', 409);
  await db.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}
