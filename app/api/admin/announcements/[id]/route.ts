/**
 * app/api/admin/announcements/[id]/route.ts
 *
 * DELETE /api/admin/announcements/:id
 * Requires: manage_announcements permission.
 * Returns 404 if the announcement does not exist, 204 on success.
 */

import { ensureDatabase } from '../../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getD1 } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return jsonError('معرّف الإعلان غير صالح', 400);
  }

  await ensureDatabase();
  const db = getD1();

  const existing = await db
    .prepare('SELECT id FROM announcements WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return jsonError('الإعلان غير موجود', 404);
  }

  await db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();

  return new Response(null, { status: 204 });
}
