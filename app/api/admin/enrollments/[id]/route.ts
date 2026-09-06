import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { resetCourseLectureViewAllowance } from '../../../../lib/video-access';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_enrollments');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = body.status
    ? String(body.status)
    : body.action === 'renew' || body.renew
    ? 'approved'
    : '';
  if (!['approved', 'rejected', 'pending'].includes(status)) return jsonError('حالة غير صالحة');
  const { id } = await params;
  const db = getDatabase();

  const enrollment = await db
    .prepare(
      'SELECT user_email AS userEmail, course_id AS courseId, status FROM enrollments WHERE id = ?'
    )
    .bind(id)
    .first<{ userEmail: string; courseId: string; status: string }>();

  if (!enrollment) return jsonError('الاشتراك غير موجود', 404);

  const now = Date.now();
  await db
    .prepare('UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run();

  if (status === 'approved') {
    await resetCourseLectureViewAllowance(enrollment.userEmail, enrollment.courseId);
  }

  return Response.json({ ok: true });
}
