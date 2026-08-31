/**
 * app/api/admin/staff/[email]/route.ts
 *
 * PATCH /api/admin/staff/:email  — update staff account (existing)
 * DELETE /api/admin/staff/:email — remove a staff account
 *
 * DELETE rules:
 *  - Requires manage_staff permission (teacher role).
 *  - Self-deletion is forbidden → 403.
 *  - Returns 404 if the account does not exist.
 *  - Hard-deletes the row (schema has no deleted_at column).
 *  - Returns 204 No Content on success.
 */

import {
  apiStaff,
  hashPassword,
  isStaffResponse,
  normalizeStaffPreset,
  STAFF_PRESETS,
} from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { isStrongPassword, jsonError, requireSameOrigin, safeText } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ email: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const actor = await apiStaff(request, 'manage_staff');
  if (isStaffResponse(actor)) return actor;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const preset = normalizeStaffPreset(body.preset);
  const isSelf = actor.email.toLowerCase() === email;
  const hasRoleChange = Object.prototype.hasOwnProperty.call(body, 'role');
  const hasActiveChange = Object.prototype.hasOwnProperty.call(body, 'active');
  if (
    isSelf &&
    ((hasRoleChange && body.role !== actor.role) ||
      (hasActiveChange && Boolean(body.active) !== true))
  ) {
    return jsonError('لا يمكنك تغيير دورك أو حالة حسابك', 403);
  }
  const role = hasRoleChange ? (body.role === 'teacher' ? 'teacher' : 'assistant') : actor.role;
  const active = hasActiveChange ? (body.active ? 1 : 0) : 1;

  const db = getDatabase();

  const now = Date.now();

  if (typeof body.password === 'string' && body.password.length > 0) {
    if (!isStrongPassword(body.password)) {
      return jsonError('كلمة المرور يجب أن تحتوي على 12 حرفاً على الأقل وحرف كبير وصغير ورقم ورمز');
    }
    const credentials = await hashPassword(body.password);
    // Change password and revoke all sessions.
    await db
      .prepare(
        `UPDATE staff_users
         SET role = ?, permissions = ?, active = ?, password_hash = ?, password_salt = ?,
             password_iterations = ?, updated_at = ?
         WHERE email = ?`
      )
      .bind(
        role,
        JSON.stringify(STAFF_PRESETS[preset]),
        active,
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        now,
        email
      )
      .run();
    await db.prepare('DELETE FROM staff_sessions WHERE staff_email = ?').bind(email).run();
  } else {
    await db
      .prepare(
        `UPDATE staff_users SET role = ?, permissions = ?, active = ?, updated_at = ? WHERE email = ?`
      )
      .bind(role, JSON.stringify(STAFF_PRESETS[preset]), active, now, email)
      .run();
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ email: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  // Only teachers with manage_staff permission can delete accounts.
  const actor = await apiStaff(request, 'manage_staff');
  if (isStaffResponse(actor)) return actor;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  // Prevent self-deletion.
  if (actor.email.toLowerCase() === email) {
    return jsonError('لا يمكنك حذف حسابك الخاص', 403);
  }

  const db = getDatabase();

  const existing = await db
    .prepare('SELECT email FROM staff_users WHERE email = ?')
    .bind(email)
    .first<{ email: string }>();

  if (!existing) {
    return jsonError('حساب الفريق غير موجود', 404);
  }

  // Revoke all active sessions first, then hard-delete.
  await db.prepare('DELETE FROM staff_sessions WHERE staff_email = ?').bind(email).run();
  await db.prepare('DELETE FROM staff_users WHERE email = ?').bind(email).run();

  return new Response(null, { status: 204 });
}

// Re-export the safeText reference to silence unused-import lint warnings.
const _unused = safeText;
void _unused;
