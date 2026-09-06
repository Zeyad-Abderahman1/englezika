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
  const rawAction = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
  const isExplicitReactivation =
    rawAction === 'reactivate' ||
    rawAction === 'renew' ||
    Boolean(body.renew) ||
    Boolean(body.reactivate);

  const status = body.status
    ? String(body.status).trim().toLowerCase()
    : isExplicitReactivation
    ? 'approved'
    : '';
  if (!['approved', 'rejected', 'pending'].includes(status)) return jsonError('حالة غير صالحة');
  const { id } = await params;
  const db = getDatabase();

  const enrollment = await db
    .prepare(
      'SELECT id, user_email, user_email AS userEmail, course_id, course_id AS courseId, status FROM enrollments WHERE id = ?'
    )
    .bind(id)
    .first<Record<string, unknown>>();

  if (!enrollment) return jsonError('الاشتراك غير موجود', 404);

  const rawUserEmail = String(
    enrollment.userEmail ?? enrollment.user_email ?? enrollment.useremail ?? ''
  ).trim().toLowerCase();
  const rawCourseId = String(
    enrollment.courseId ?? enrollment.course_id ?? enrollment.courseid ?? ''
  ).trim();
  const previousStatus = String(enrollment.status ?? '').trim().toLowerCase();

  const now = Date.now();
  await db
    .prepare('UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run();

  const shouldResetViews =
    status === 'approved' &&
    (isExplicitReactivation || previousStatus !== 'approved');

  let resetChanges = 0;
  if (shouldResetViews && rawUserEmail && rawCourseId) {
    const resetResult = await resetCourseLectureViewAllowance(rawUserEmail, rawCourseId);
    resetChanges = resetResult.changes;
  }

  return Response.json({
    ok: true,
    status,
    reactivated: isExplicitReactivation,
    viewsReset: shouldResetViews,
    resetChanges,
  });
}
