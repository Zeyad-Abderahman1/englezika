import { apiUser, isResponse } from '../../../../../lib/api-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError } from '../../../../../lib/security';
import { isEmailVerified } from '../../../../../lib/email-verification';

/**
 * GET /api/student/assignments/[id]/teacher-file
 *
 * Serve the teacher's assignment PDF to an enrolled student.
 * Requires active enrollment and email verification.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (isResponse(user)) return user;

  if (!(await isEmailVerified(user.email))) {
    return jsonError('يجب تأكيد البريد الإلكتروني أولاً', 403);
  }

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();

  // Verify enrollment
  const assignment = await db
    .prepare(
      `SELECT a.id FROM assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.id = ? AND e.user_email = ? AND e.status = 'approved'
         AND a.status = 'published' LIMIT 1`
    )
    .bind(id, email)
    .first();
  if (!assignment) return jsonError('الواجب غير متاح', 403);

  const storage = getPrivateStorage();
  const file = await storage.get(`assignments/${id}/teacher.pdf`);
  if (!file) return jsonError('ملف الواجب غير موجود', 404);

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="assignment-${id}.pdf"`,
      'content-length': String(file.size),
      'cache-control': 'no-store',
    },
  });
}
