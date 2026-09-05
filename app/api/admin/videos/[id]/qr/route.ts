import { recordAuditLog } from '../../../../../lib/audit';
import {
  buildLectureQRUrl,
  generateLectureQRToken,
  hashLectureQRToken,
  lectureQRCodeSuffix,
  normalizeLectureQRToken,
} from '../../../../../lib/lecture-access-codes';
import { getDatabase } from '../../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../../lib/security';
import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const videoId = safeText((await params).id, 80);
  if (!videoId) return jsonError('المحاضرة غير صالحة', 400);

  const db = getDatabase();
  const video = await db
    .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
    .bind(videoId)
    .first<{ id: string; courseId: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateLectureQRToken();
    const normalized = normalizeLectureQRToken(token);
    if (!normalized) throw new Error('Generated lecture QR token did not pass validation');
    const codeHash = await hashLectureQRToken(normalized);
    const suffix = lectureQRCodeSuffix(normalized);
    const createdAt = Date.now();
    const inserted = await db
      .prepare(
        `INSERT INTO lecture_access_codes
          (id, code_hash, display_suffix, course_id, video_id, created_by_staff_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code_hash) DO NOTHING RETURNING id`
      )
      .bind(
        crypto.randomUUID(),
        codeHash,
        suffix,
        video.courseId,
        video.id,
        staff.email.toLowerCase(),
        createdAt
      )
      .first<{ id: string }>();
    if (!inserted) continue;

    await recordAuditLog({
      userEmail: staff.email,
      action: 'lecture_qr.created',
      resource: 'video',
      resourceId: video.id,
      details: { courseId: video.courseId },
      request,
    });

    const url = buildLectureQRUrl(token, new URL(request.url).origin);
    return Response.json(
      {
        token,
        url,
        displaySuffix: suffix,
        createdAt,
      },
      { status: 201, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  return jsonError('تعذر إنشاء رمز QR آمن الآن. حاول مرة أخرى.', 503);
}
