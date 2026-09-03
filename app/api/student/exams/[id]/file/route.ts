import { apiVerifiedUser, isResponse } from '../../../../../lib/api-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError } from '../../../../../lib/security';
import { hasCourseItems, getCourseSequenceUnlockState } from '../../../../../lib/course-sequence';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const { id } = await params;
  const email = user.email.toLowerCase();
  const db = getDatabase();

  const exam = await db
    .prepare(
      `SELECT x.id, x.course_id AS courseId FROM exams x
       LEFT JOIN enrollments e ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
       WHERE x.id = ? AND x.status = 'published' AND x.mode = 'file'
         AND (x.course_id IS NULL OR e.id IS NOT NULL)`
    )
    .bind(email, id)
    .first<{ id: string; courseId: string | null }>();
  if (!exam) return jsonError('الامتحان غير متاح', 403);

  if (exam.courseId) {
    const courseHasSequence = await hasCourseItems(exam.courseId);
    if (courseHasSequence) {
      const unlockState = await getCourseSequenceUnlockState(exam.courseId, email);
      const key = `exam:${id}`;
      const state = unlockState.get(key);
      if (state && !state.unlocked) {
        return jsonError('يجب إكمال العناصر السابقة في تسلسل التعلم أولاً', 403);
      }
    }
  }

  const storage = getPrivateStorage();
  const file = await storage.get(`exams/${id}/teacher.pdf`);
  if (!file) return jsonError('ملف الامتحان غير موجود', 404);

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="exam-${id}.pdf"`,
      'content-length': String(file.size),
      'cache-control': 'no-store',
    },
  });
}
