import { ensureDatabase } from '../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getD1 } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';

export async function POST(request: Request) {
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
  if (title.length < 3 || grade.length < 2) return jsonError('اسم الكورس والصف مطلوبان');
  const id = crypto.randomUUID();
  const now = Date.now();
  await ensureDatabase();
  try {
    await getD1()
      .prepare(
        `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, title, grade, description, price, status, now, now)
      .run();
  } catch {
    return jsonError('تعذر إضافة الكورس، حاول مرة أخرى', 500);
  }
  return Response.json({ ok: true, id });
}
