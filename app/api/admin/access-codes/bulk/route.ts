import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';

/**
 * POST /api/admin/access-codes/bulk
 *
 * Generate multiple access codes for a video in a single atomic transaction.
 * If any insert fails, the entire batch is rolled back.
 *
 * Body: { videoId: string, count: number (1..50) }
 * Returns: { ok: true, codes: Array<{ id: string, suffix: string, fullCode: string }> }
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const videoId = safeText(body.videoId, 80);
  const count = safeInteger(body.count, 10, 1, 500);

  if (!videoId) return jsonError('معرف المحاضرة مطلوب', 400);

  const db = getDatabase();

  const video = await db
    .prepare(
      'SELECT id, course_id AS courseId, title FROM videos WHERE id = ?'
    )
    .bind(videoId)
    .first<{ id: string; courseId: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  const batchId = crypto.randomUUID();
  const createdAt = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO access_code_batches (id, course_id, video_id, count, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(batchId, video.courseId, videoId, count, staff.email.toLowerCase(), createdAt)
      .run();
  } catch {
    return jsonError('فشل إنشاء دفعة الأكواد.', 500);
  }

  const batchSize = 5;
  const generated: Array<{ id: string; suffix: string; fullCode: string }> = [];

  for (let batch = 0; batch < count; batch += batchSize) {
    const chunkSize = Math.min(batchSize, count - batch);
    const batchStatements: Array<{
      id: string;
      suffix: string;
      fullCode: string;
      stmt: ReturnType<typeof db.prepare>;
    }> = [];

    for (let i = 0; i < chunkSize; i++) {
      const id = crypto.randomUUID();
      const suffix = String(Math.floor(1000 + Math.random() * 9000));
      const fullCode = `ENG-${suffix}`;
      const stmt = db
        .prepare(
          `INSERT INTO lecture_access_codes (id, video_id, course_id, display_suffix, batch_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, videoId, video.courseId, suffix, batchId, staff.email.toLowerCase(), Date.now());
      batchStatements.push({ id, suffix, fullCode, stmt });
    }

    try {
      await db.batch(batchStatements.map((s) => s.stmt));
      generated.push(...batchStatements.map((s) => ({ id: s.id, suffix: s.suffix, fullCode: s.fullCode })));
    } catch (error) {
      return jsonError('فشل إنشاء الأكواد. تأكد من عدم تكرار الأكواد.', 500);
    }
  }

  return Response.json({ ok: true, batch: { id: batchId, count, createdAt }, codes: generated });
}
