import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getDatabase } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';

function optionalTimestamp(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined;
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  const title = safeText(body.title, 150);
  const description = safeText(body.description, 3000);
  const dueAt = optionalTimestamp(body.dueAt);
  const maxScore = safeInteger(body.maxScore, 0, 0, 10_000);
  const status = body.status === 'published' ? 'published' : 'draft';
  if (!courseId || title.length < 3) return jsonError('اختر الكورس وأدخل عنواناً صحيحاً للواجب');
  if (body.dueAt !== undefined && dueAt === undefined)
    return jsonError('موعد تسليم الواجب غير صالح');

  const db = getDatabase();
  const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
  if (!course) return jsonError('الكورس المحدد غير موجود', 404);

  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO assignments
       (id, course_id, title, description, due_at, max_score, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, courseId, title, description, dueAt ?? null, maxScore, status, staff.email, now, now)
    .run();
  return Response.json({ ok: true, id });
}
