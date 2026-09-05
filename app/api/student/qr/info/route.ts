import { getCurrentStudentUser } from '../../../../lib/api-auth';
import {
  hashLectureAccessCode,
  hasLectureAccess,
  normalizeLectureAccessCode,
} from '../../../../lib/lecture-access-codes';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, safeText } from '../../../../lib/security';

async function handleQRInfo(rawToken: string, request: Request) {
  const normalized = normalizeLectureAccessCode(rawToken);
  if (!normalized) {
    return Response.json(
      {
        ok: false,
        error: 'INVALID_QR_FORMAT',
        message: 'صيغة رمز QR غير صحيحة.',
      },
      { status: 400 }
    );
  }

  const codeHash = await hashLectureAccessCode(normalized);
  const db = getDatabase();

  const codeRecord = await db
    .prepare(
      `SELECT lac.id, lac.course_id AS courseId, lac.video_id AS videoId,
              lac.redeemed_at AS redeemedAt,
              v.title AS videoTitle, v.description AS videoDescription,
              c.title AS courseTitle, c.stage AS stage
       FROM lecture_access_codes lac
       JOIN videos v ON v.id = lac.video_id
       JOIN courses c ON c.id = lac.course_id
       WHERE lac.code_hash = ?
       LIMIT 1`
    )
    .bind(codeHash)
    .first<{
      id: string;
      courseId: string;
      videoId: string;
      redeemedAt: number | null;
      videoTitle: string;
      videoDescription: string | null;
      courseTitle: string;
      stage: string | null;
    }>();

  if (!codeRecord) {
    return Response.json(
      {
        ok: false,
        error: 'QR_NOT_FOUND',
        message: 'رمز QR غير موجود أو غير صالح.',
      },
      { status: 404 }
    );
  }

  if (codeRecord.redeemedAt !== null) {
    return Response.json(
      {
        ok: false,
        isRedeemed: true,
        error: 'QR_ALREADY_USED',
        message: 'تم استخدام رمز QR هذا مسبقًا ولا يمكن استخدامه مرة أخرى.',
        videoTitle: codeRecord.videoTitle,
        courseTitle: codeRecord.courseTitle,
      },
      { status: 409 }
    );
  }

  // Check student session
  const student = await getCurrentStudentUser(request);
  let alreadyHasAccess = false;
  if (student?.email) {
    alreadyHasAccess = await hasLectureAccess(db, student.email, codeRecord.videoId);
  }

  return Response.json(
    {
      ok: true,
      isRedeemed: false,
      alreadyHasAccess,
      video: {
        id: codeRecord.videoId,
        title: codeRecord.videoTitle,
        description: codeRecord.videoDescription,
        courseId: codeRecord.courseId,
        courseTitle: codeRecord.courseTitle,
        stage: codeRecord.stage,
      },
      student: student ? { email: student.email, name: student.displayName || student.fullName } : null,
    },
    {
      headers: {
        'cache-control': 'private, no-store',
      },
    }
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const rawToken = safeText(body.token, 120);
  if (!rawToken) {
    return jsonError('رمز QR مطلوب', 400);
  }
  return handleQRInfo(rawToken, request);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawToken = safeText(searchParams.get('token') || '', 120);
  if (!rawToken) {
    return jsonError('رمز QR مطلوب', 400);
  }
  return handleQRInfo(rawToken, request);
}
