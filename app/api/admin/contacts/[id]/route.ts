import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_messages');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = safeText(body.status, 30);
  if (!['new', 'reviewed'].includes(status)) return jsonError('حالة غير صالحة');
  const { id } = await params;
  const contact = await getDatabase().prepare('SELECT id FROM contacts WHERE id = ?').bind(id).first();
  if (!contact) return jsonError('الرسالة غير موجودة', 404);
  await getDatabase().prepare('UPDATE contacts SET status = ? WHERE id = ?').bind(status, id).run();
  return Response.json({ ok: true });
}
