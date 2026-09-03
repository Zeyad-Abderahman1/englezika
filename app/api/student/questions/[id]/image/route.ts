import { apiVerifiedUser, isResponse } from '../../../../../lib/api-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const { id: questionId } = await params;
  if (!questionId || questionId.length > 80) {
    return Response.json({ error: 'Identifiant invalide' }, { status: 400 });
  }

  const db = getDatabase();
  const normalizedEmail = user.email.toLowerCase();

  const question = await db
    .prepare(
      `SELECT q.image_file_key AS imageFileKey, q.exam_id AS examId
       FROM questions q
       WHERE q.id = ? AND q.image_file_key IS NOT NULL
       LIMIT 1`
    )
    .bind(questionId)
    .first<{ imageFileKey: string; examId: string }>();

  if (!question) {
    return Response.json({ error: 'Image non trouvée' }, { status: 404 });
  }

  const exam = await db
    .prepare('SELECT course_id AS courseId FROM exams WHERE id = ?')
    .bind(question.examId)
    .first<{ courseId: string }>();

  if (!exam) {
    return Response.json({ error: 'Examen non trouvé' }, { status: 404 });
  }

  const enrollment = await db
    .prepare(
      "SELECT 1 FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
    )
    .bind(normalizedEmail, exam.courseId)
    .first();

  if (!enrollment) {
    return Response.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const storage = getPrivateStorage();
  const file = await storage.get(question.imageFileKey);
  if (!file) {
    return Response.json({ error: 'Image non trouvée' }, { status: 404 });
  }

  const ext = question.imageFileKey.split('.').pop()?.toLowerCase() || 'png';
  const contentType =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/png';

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
