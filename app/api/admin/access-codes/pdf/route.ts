import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';
import { generateAccessCodePDF } from '../../../../lib/pdf-generator';

/**
 * POST /api/admin/access-codes/pdf
 *
 * Generate a printable PDF of access codes for a given video.
 * Body: { videoId: string }
 * Returns: application/pdf
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const videoId = safeText(body.videoId, 80);
  if (!videoId) return jsonError('معرف المحاضرة مطلوب', 400);

  const db = getDatabase();

  const video = await db
    .prepare('SELECT id, title FROM videos WHERE id = ?')
    .bind(videoId)
    .first<{ id: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  let codeRows: Array<{ id: string; suffix: string; fullCode: string; videoTitle: string }> = [];

  if (Array.isArray(body.codes) && body.codes.length > 0) {
    codeRows = body.codes
      .filter((c: unknown): c is { fullCode: string; suffix?: string; id?: string } =>
        typeof c === 'object' && c !== null && typeof (c as { fullCode?: unknown }).fullCode === 'string'
      )
      .map((c, idx) => ({
        id: c.id || `code-${idx}`,
        suffix: c.suffix || c.fullCode.slice(-5),
        fullCode: c.fullCode,
        videoTitle: video.title,
      }));
  } else {
    const codes = await db
      .prepare(
        `SELECT id, display_suffix AS suffix,
                'ENG-•••••-' || display_suffix AS fullCode
         FROM lecture_access_codes
         WHERE video_id = ? AND redeemed_at IS NULL
         ORDER BY created_at ASC`
      )
      .bind(videoId)
      .all<{ id: string; suffix: string; fullCode: string }>();

    codeRows = codes.results.map((c) => ({
      ...c,
      videoTitle: video.title,
    }));
  }

  if (!codeRows.length) {
    return jsonError('لا توجد أكواد متاحة للطباعة', 404);
  }

  const pdfBuffer = await generateAccessCodePDF(codeRows, {
    title: `Access Codes - ${video.title}`,
  });

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="access-codes-${videoId}.pdf"`,
      'Content-Length': String(pdfBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
