import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';
import { generateAccessCodePDF } from '../../../../lib/pdf-generator';
import {
  buildLectureQRUrl,
  hashLectureQRToken,
  lectureQRCodeSuffix,
  normalizeLectureQRToken,
} from '../../../../lib/lecture-access-codes';

/**
 * POST /api/admin/qr/pdf
 *
 * Generate a printable PDF of freshly generated QR codes for a given video.
 * Plaintext tokens exist only in memory upon generation and must be submitted in the request.
 *
 * Body: { videoId: string, tokens: string[] | Array<{ token?: string }> }
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

  const rawTokensList = Array.isArray(body.tokens)
    ? body.tokens
    : Array.isArray(body.codes)
      ? body.codes
      : null;

  if (!rawTokensList || rawTokensList.length === 0) {
    return Response.json(
      {
        error: 'PLAINTEXT_TOKENS_REQUIRED',
        message:
          'لأسباب أمنية لا يتم تخزين رموز QR بصورتها الأصلية في الخادم. يجب تحميل ملف PDF فور إنشاء الرموز.',
      },
      { status: 400 }
    );
  }

  if (rawTokensList.length > 500) {
    return jsonError('الحد الأقصى لطباعة الرموز هو 500 رمز في الطلب الواحد', 400);
  }

  const db = getDatabase();

  const video = await db
    .prepare('SELECT id, title FROM videos WHERE id = ?')
    .bind(videoId)
    .first<{ id: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  type ParsedToken = {
    original: string;
    normalized: string;
    hash: string;
    suffix: string;
  };

  const parsedTokens: ParsedToken[] = [];

  for (const rawItem of rawTokensList) {
    let rawString: string | null = null;
    if (typeof rawItem === 'string') {
      rawString = rawItem.trim();
    } else if (typeof rawItem === 'object' && rawItem !== null) {
      const obj = rawItem as { token?: unknown; fullCode?: unknown; code?: unknown };
      if (typeof obj.token === 'string') {
        rawString = obj.token.trim();
      } else if (typeof obj.fullCode === 'string') {
        rawString = obj.fullCode.trim();
      } else if (typeof obj.code === 'string') {
        rawString = obj.code.trim();
      }
    }

    if (!rawString) {
      return jsonError('رموز غير صالحة', 400);
    }

    const normalized = normalizeLectureQRToken(rawString);
    if (!normalized) {
      return jsonError('رموز غير صالحة أو غير مطابقة للنمط المطلوب', 400);
    }

    const hash = await hashLectureQRToken(normalized);
    parsedTokens.push({
      original: rawString,
      normalized,
      hash,
      suffix: lectureQRCodeSuffix(normalized),
    });
  }

  const uniqueHashes = Array.from(new Set(parsedTokens.map((c) => c.hash)));
  const placeholders = uniqueHashes.map(() => '?').join(', ');
  const existingRows = await db
    .prepare(
      `SELECT id, code_hash AS codeHash, video_id AS videoId, redeemed_at AS redeemedAt
       FROM lecture_access_codes
       WHERE code_hash IN (${placeholders})`
    )
    .bind(...uniqueHashes)
    .all<{ id: string; codeHash: string; videoId: string; redeemedAt: number | null }>();

  const rowMap = new Map<string, { id: string; videoId: string; redeemedAt: number | null }>();
  for (const rawRow of existingRows.results) {
    const row = rawRow as Record<string, unknown>;
    const codeHash = String(row.codeHash ?? row.codehash ?? '');
    const rowVideoId = String(row.videoId ?? row.videoid ?? '');
    const redeemedAt =
      row.redeemedAt !== undefined && row.redeemedAt !== null
        ? Number(row.redeemedAt)
        : row.redeemedat !== undefined && row.redeemedat !== null
          ? Number(row.redeemedat)
          : null;
    if (codeHash) {
      rowMap.set(codeHash, {
        id: String(row.id || ''),
        videoId: rowVideoId,
        redeemedAt,
      });
    }
  }

  for (const item of parsedTokens) {
    const dbRow = rowMap.get(item.hash);
    if (!dbRow || dbRow.videoId !== videoId || dbRow.redeemedAt !== null) {
      return jsonError('رموز غير صالحة أو غير مخصصة لهذه المحاضرة أو تم استخدامها بالفعل', 400);
    }
  }

  const requestOrigin = new URL(request.url).origin;
  const qrRows = parsedTokens.map((item, idx) => {
    const dbRow = rowMap.get(item.hash)!;
    return {
      id: dbRow.id || `qr-${idx}`,
      suffix: item.suffix,
      token: item.original,
      url: buildLectureQRUrl(item.original, requestOrigin),
      videoTitle: video.title,
    };
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateAccessCodePDF(qrRows, {
      title: `Lecture QR Codes - ${video.title}`,
    });
  } catch {
    return jsonError('تعذر إنشاء ملف PDF لرموز QR', 500);
  }

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="lecture-qr-codes-${videoId}.pdf"`,
      'Content-Length': String(pdfBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
