/**
 * app/api/admin/announcements/[id]/route.ts
 *
 * DELETE /api/admin/announcements/:id
 * Requires: manage_announcements permission.
 * Returns 404 if the announcement does not exist, 204 on success.
 */

import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('معرّف الإعلان غير صالح', 400);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title, 150);
  const content = safeText(body.body, 2000);
  if (title.length < 3 || content.length < 3) return jsonError('عنوان الإعلان ومحتواه مطلوبان');
  const db = getDatabase();
  const result = await db
    .prepare('UPDATE announcements SET title = ?, body = ? WHERE id = ?')
    .bind(title, content, id)
    .run();
  if (result.meta.changes !== 1) return jsonError('الإعلان غير موجود', 404);
  await db
    .prepare(
      "DELETE FROM notification_reads WHERE notification_type = 'announcement' AND notification_id = ?"
    )
    .bind(id)
    .run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return jsonError('معرّف الإعلان غير صالح', 400);
  }

  const db = getDatabase();

  const existing = await db
    .prepare('SELECT id FROM announcements WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return jsonError('الإعلان غير موجود', 404);
  }

  await db.batch([
    db
      .prepare(
        "DELETE FROM notification_reads WHERE notification_type = 'announcement' AND notification_id = ?"
      )
      .bind(id),
    db.prepare('DELETE FROM announcements WHERE id = ?').bind(id),
  ]);

  return new Response(null, { status: 204 });
}
