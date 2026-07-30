import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_enrollments');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status);
  if (!['approved', 'rejected', 'pending'].includes(status)) return jsonError('حالة غير صالحة');
  const { id } = await params;
  await getDatabase()
    .prepare('UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, Date.now(), id)
    .run();
  return Response.json({ ok: true });
}
