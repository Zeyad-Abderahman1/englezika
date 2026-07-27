import { ensureDatabase } from '../../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getD1, getVideoBucket } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const existing = await db
    .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string }>();
  if (!existing) return jsonError('الفيديو غير موجود', 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title ?? '', 150);
  if (title.length < 2) return jsonError('عنوان الفيديو مطلوب');
  const prerequisiteExamId = null;
  const minimumScore = 0;
  const status = body.status === 'draft' ? 'draft' : 'published';
  await db
    .prepare(
      'UPDATE videos SET title = ?, prerequisite_exam_id = ?, minimum_score = ?, status = ? WHERE id = ?'
    )
    .bind(title, prerequisiteExamId, minimumScore, status, id)
    .run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const video = await db
    .prepare('SELECT r2_key AS r2Key FROM videos WHERE id = ?')
    .bind(id)
    .first<{ r2Key: string }>();
  if (!video) return jsonError('الفيديو غير موجود', 404);
  await getVideoBucket().delete(video.r2Key);
  await db.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return Response.json({ ok: true });
}
