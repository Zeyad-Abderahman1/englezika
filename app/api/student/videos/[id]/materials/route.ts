import { apiVerifiedUser, isResponse } from '../../../../../lib/api-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { hasCourseItems, getCourseSequenceUnlockState } from '../../../../../lib/course-sequence';

/**
 * GET /api/student/videos/[id]/materials
 * Returns all lecture material PDFs for an enrolled student.
 * Enforces course sequence lock — same authorization as video access.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();

  const video = await db
    .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string }>();
  if (!video) return Response.json({ error: 'المحاضرة غير موجودة' }, { status: 404 });

  const enrollment = await db
    .prepare(
      "SELECT 1 FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
    )
    .bind(email, video.courseId)
    .first();
  if (!enrollment) {
    return Response.json({ error: 'غير مصرح بالدخول' }, { status: 403 });
  }

  const courseHasSequence = await hasCourseItems(video.courseId);
  if (courseHasSequence) {
    const unlockState = await getCourseSequenceUnlockState(video.courseId, email);
    const key = `video:${id}`;
    const state = unlockState.get(key);
    if (state && !state.unlocked) {
      return Response.json(
        { error: 'يجب إكمال العناصر السابقة في تسلسل التعلم أولاً' },
        { status: 403 }
      );
    }
  }

  const materials = await db
    .prepare(
      'SELECT id, storage_key AS storageKey, file_name AS fileName, file_size AS fileSize FROM lecture_materials WHERE video_id = ? ORDER BY created_at'
    )
    .bind(id)
    .all<{ id: string; storageKey: string; fileName: string; fileSize: number }>();

  if (!materials.results.length) {
    return Response.json({ error: 'لا توجد مادة مرفقة' }, { status: 404 });
  }

  const storage = getPrivateStorage();

  const url = new URL(_request.url);
  const downloadId = url.searchParams.get('download');

  if (downloadId) {
    const material = materials.results.find((m) => m.id === downloadId);
    if (!material) {
      return Response.json({ error: 'الملف غير موجود' }, { status: 404 });
    }

    const file = await storage.get(material.storageKey);
    if (!file) {
      return Response.json({ error: 'الملف غير موجود في التخزين' }, { status: 404 });
    }

    return new Response(file.body as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(material.fileName)}.pdf"`,
        'Content-Length': String(file.size),
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  }

  return Response.json({
    materials: materials.results.map((m) => ({
      id: m.id,
      fileName: m.fileName,
      fileSize: m.fileSize,
    })),
  });
}
