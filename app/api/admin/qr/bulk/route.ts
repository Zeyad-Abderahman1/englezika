import { recordAuditLog } from '../../../../lib/audit';
import {
  buildLectureQRUrl,
  generateLectureQRToken,
  hashLectureQRToken,
  lectureQRCodeSuffix,
  normalizeLectureQRToken,
} from '../../../../lib/lecture-access-codes';
import { getDatabase } from '../../../../lib/platform';
import type { PreparedStatement } from '../../../../lib/database';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';

/**
 * POST /api/admin/qr/bulk
 *
 * Generate multiple single-use cryptographic QR tokens for a video in a single atomic transaction.
 * If any insert fails, the entire batch is rolled back leaving zero partial records.
 *
 * Body: { videoId: string, count: number (1..500) }
 * Returns: { ok: true, batch: { id: string, count: number, createdAt: number }, qrCodes: Array<{ id, suffix, token, url }> }
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const videoId = safeText(body.videoId, 80);
  const count = safeInteger(body.count, 5, 1, 500);

  if (!videoId) return jsonError('معرف المحاضرة مطلوب', 400);

  const db = getDatabase();

  const video = await db
    .prepare('SELECT id, course_id AS courseId, title FROM videos WHERE id = ?')
    .bind(videoId)
    .first<{ id: string; courseId: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  const batchId = crypto.randomUUID();
  const createdAt = Date.now();
  const staffEmail = staff.email.toLowerCase();
  const requestOrigin = new URL(request.url).origin;

  const generatedQRCodes: Array<{
    id: string;
    suffix: string;
    token: string;
    url: string;
  }> = [];
  const seenHashes = new Set<string>();
  const statements: PreparedStatement[] = [];

  // 1. Insert access_code_batches record
  statements.push(
    db
      .prepare(
        `INSERT INTO access_code_batches (id, course_id, video_id, count, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(batchId, video.courseId, video.id, count, staffEmail, createdAt)
  );

  // 2. Prepare atomic insertion for each cryptographic QR token
  for (let i = 0; i < count; i++) {
    let token = '';
    let codeHash = '';
    let suffix = '';

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateLectureQRToken();
      const normalized = normalizeLectureQRToken(candidate);
      if (!normalized) continue;
      const h = await hashLectureQRToken(normalized);
      if (!seenHashes.has(h)) {
        seenHashes.add(h);
        token = candidate;
        codeHash = h;
        suffix = lectureQRCodeSuffix(normalized);
        break;
      }
    }

    if (!codeHash) {
      return jsonError('تعذر إنشاء رموز QR الفريدة. حاول مرة أخرى.', 500);
    }

    const codeId = crypto.randomUUID();
    const url = buildLectureQRUrl(token, requestOrigin);
    generatedQRCodes.push({ id: codeId, suffix, token, url });

    statements.push(
      db
        .prepare(
          `INSERT INTO lecture_access_codes
            (id, code_hash, display_suffix, course_id, video_id, created_by_staff_email, created_at, batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          codeId,
          codeHash,
          suffix,
          video.courseId,
          video.id,
          staffEmail,
          createdAt,
          batchId
        )
    );
  }

  // Execute all inserts atomically in a single transaction (BEGIN ... COMMIT with ROLLBACK)
  try {
    await db.batch(statements);
  } catch {
    return jsonError('فشل إنشاء دفعة رموز QR في قاعدة البيانات.', 500);
  }

  await recordAuditLog({
    userEmail: staff.email,
    action: 'lecture_qr.bulk_created',
    resource: 'video',
    resourceId: video.id,
    details: { courseId: video.courseId, batchId, count },
    request,
  });

  return Response.json(
    {
      ok: true,
      batch: { id: batchId, count, createdAt },
      qrCodes: generatedQRCodes,
    },
    { status: 201, headers: { 'cache-control': 'private, no-store' } }
  );
}
