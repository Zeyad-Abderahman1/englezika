import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';
import { generateAccessCodePDF } from '../../../../lib/pdf-generator';
import {
  hashLectureAccessCode,
  lectureAccessCodeSuffix,
  normalizeLectureAccessCode,
} from '../../../../lib/lecture-access-codes';

/**
 * POST /api/admin/access-codes/pdf
 *
 * Generate a printable PDF of freshly generated access codes for a given video.
 * Plaintext codes exist only in memory upon generation and must be submitted in the request.
 *
 * Body: { videoId: string, codes: string[] | Array<{ fullCode: string }> }
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

  if (!Array.isArray(body.codes) || body.codes.length === 0) {
    return Response.json(
      {
        error: 'PLAINTEXT_CODES_REQUIRED',
        message:
          'لأسباب أمنية لا يتم تخزين الأكواد بصورتها الأصلية. يجب تحميل ملف PDF فور إنشاء الأكواد.',
      },
      { status: 400 }
    );
  }

  if (body.codes.length > 500) {
    return jsonError('الحد الأقصى لطباعة الأكواد هو 500 كود في الطلب الواحد', 400);
  }

  const db = getDatabase();

  const video = await db
    .prepare('SELECT id, title FROM videos WHERE id = ?')
    .bind(videoId)
    .first<{ id: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  type ParsedCode = {
    original: string;
    normalized: string;
    hash: string;
    suffix: string;
  };

  const parsedCodes: ParsedCode[] = [];

  for (const rawItem of body.codes) {
    let rawString: string | null = null;
    if (typeof rawItem === 'string') {
      rawString = rawItem.trim();
    } else if (typeof rawItem === 'object' && rawItem !== null) {
      const obj = rawItem as { fullCode?: unknown; code?: unknown };
      if (typeof obj.fullCode === 'string') {
        rawString = obj.fullCode.trim();
      } else if (typeof obj.code === 'string') {
        rawString = obj.code.trim();
      }
    }

    if (!rawString) {
      return jsonError('أكواد غير صالحة', 400);
    }

    const normalized = normalizeLectureAccessCode(rawString);
    if (!normalized) {
      return jsonError('أكواد غير صالحة أو غير مطابقة للنمط المطلوب', 400);
    }

    const hash = await hashLectureAccessCode(normalized);
    parsedCodes.push({
      original: rawString,
      normalized,
      hash,
      suffix: lectureAccessCodeSuffix(normalized),
    });
  }

  const uniqueHashes = Array.from(new Set(parsedCodes.map((c) => c.hash)));
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

  for (const item of parsedCodes) {
    const dbRow = rowMap.get(item.hash);
    if (!dbRow || dbRow.videoId !== videoId || dbRow.redeemedAt !== null) {
      return jsonError('أكواد غير صالحة أو غير مخصصة لهذه المحاضرة أو تم استخدامها بالفعل', 400);
    }
  }

  const codeRows = parsedCodes.map((item, idx) => {
    const dbRow = rowMap.get(item.hash)!;
    return {
      id: dbRow.id || `code-${idx}`,
      suffix: item.suffix,
      fullCode: item.original,
      videoTitle: video.title,
    };
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateAccessCodePDF(codeRows, {
      title: `Access Codes - ${video.title}`,
    });
  } catch (pdfError) {
    return jsonError('تعذر إنشاء ملف PDF للأكواد', 500);
  }

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="access-codes-${videoId}.pdf"`,
      'Content-Length': String(pdfBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
