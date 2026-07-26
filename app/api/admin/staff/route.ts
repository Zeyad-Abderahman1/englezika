import { ensureDatabase } from '../../../../db/runtime';
import {
  apiStaff,
  hashPassword,
  isStaffResponse,
  normalizeStaffPreset,
  STAFF_PRESETS,
} from '../../../lib/staff-auth';
import { getD1 } from '../../../lib/platform';
import { isStrongPassword, jsonError, requireSameOrigin, safeText } from '../../../lib/security';

export async function GET(request: Request) {
  const actor = await apiStaff(request, 'manage_staff');
  if (isStaffResponse(actor)) return actor;
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT email, name, role, permissions, active, locked_until AS lockedUntil,
     created_at AS createdAt, updated_at AS updatedAt
     FROM staff_users ORDER BY CASE role WHEN 'teacher' THEN 0 ELSE 1 END, created_at`
    )
    .all();
  return Response.json({ staff: result.results });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const actor = await apiStaff(request, 'manage_staff');
  if (isStaffResponse(actor)) return actor;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = safeText(body.email, 254).toLowerCase();
  const name = safeText(body.name, 120);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'teacher' ? 'teacher' : 'assistant';
  const preset = role === 'teacher' ? 'full_access' : normalizeStaffPreset(body.preset);
  if (role === 'assistant' && preset === 'full_access') {
    return jsonError('اختر صلاحيات محددة للمساعد');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2) {
    return jsonError('أدخل اسماً وبريداً إلكترونياً صحيحين');
  }
  if (!isStrongPassword(password)) {
    return jsonError('كلمة المرور يجب أن تحتوي على 12 حرفاً على الأقل وحرف كبير وصغير ورقم ورمز');
  }
  await ensureDatabase();
  const credentials = await hashPassword(password);
  const now = Date.now();
  try {
    await getD1()
      .prepare(
        `INSERT INTO staff_users
       (email, name, role, permissions, password_hash, password_salt, password_iterations,
        active, failed_attempts, locked_until, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?, ?)`
      )
      .bind(
        email,
        name,
        role,
        JSON.stringify(STAFF_PRESETS[preset]),
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        actor.email,
        now,
        now
      )
      .run();
  } catch {
    return jsonError('هذا البريد مستخدم بالفعل لحساب فريق', 409);
  }
  return Response.json({ ok: true });
}
