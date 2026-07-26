import type { Metadata } from 'next';
import Link from 'next/link';
import { ensureDatabase } from '../../../db/runtime';
import { getD1 } from '../../lib/platform';
import { isEmailVerified } from '../../lib/email-verification';
import SecureVideoPlayer from '../../components/SecureVideoPlayer';
import { requireStudentUser } from '../../lib/student-session';

export const metadata: Metadata = { title: 'مشاهدة الكورس' };
export const dynamic = 'force-dynamic';

export default async function LearnPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const user = await requireStudentUser(`/learn/${courseId}`);
  await ensureDatabase();
  const db = getD1();
  if (!(await isEmailVerified(user.email))) {
    return (
      <main className="portal-page">
        <div className="container">
          <div className="access-denied">
            <div className="access-icon">!</div>
            <h1>أكد بريدك الإلكتروني أولًا</h1>
            <p>أرسل كود التفعيل من حسابك وأدخله لفتح الكورسات والامتحانات بأمان.</p>
            <Link href="/account" className="btn btn-primary">
              تأكيد البريد الإلكتروني
            </Link>
          </div>
        </div>
      </main>
    );
  }
  const enrollment = await db
    .prepare(
      "SELECT id FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
    )
    .bind(user.email.toLowerCase(), courseId)
    .first();
  if (!enrollment) {
    return (
      <main className="portal-page">
        <div className="container">
          <div className="access-denied">
            <div className="access-icon">!</div>
            <h1>الكورس غير مفعّل على حسابك</h1>
            <p>أرسل طلب الاشتراك أو انتظر مراجعة الدفع من الإدارة.</p>
            <Link href="/account" className="btn btn-primary">
              العودة إلى حسابي
            </Link>
          </div>
        </div>
      </main>
    );
  }
  const course = await db
    .prepare('SELECT title, grade FROM courses WHERE id = ?')
    .bind(courseId)
    .first<{ title: string; grade: string }>();
  const result = await db
    .prepare(
      `SELECT v.id, v.title, v.duration_seconds AS durationSeconds,
     v.prerequisite_exam_id AS prerequisiteExamId, v.minimum_score AS minimumScore,
     x.title AS prerequisiteExamTitle,
     CASE WHEN v.prerequisite_exam_id IS NULL THEN 1
       WHEN EXISTS (
         SELECT 1 FROM attempts a
         WHERE a.exam_id = v.prerequisite_exam_id AND a.user_email = ?
         AND (CASE WHEN a.max_score > 0 THEN a.score * 100.0 / a.max_score ELSE 0 END) >= v.minimum_score
       ) THEN 1 ELSE 0 END AS unlocked
     FROM videos v LEFT JOIN exams x ON x.id = v.prerequisite_exam_id
     WHERE v.course_id = ? AND v.status = 'published' ORDER BY v.created_at`
    )
    .bind(user.email.toLowerCase(), courseId)
    .all<{
      id: string;
      title: string;
      durationSeconds: number;
      prerequisiteExamId: string | null;
      prerequisiteExamTitle: string | null;
      minimumScore: number;
      unlocked: number;
    }>();
  return (
    <main className="portal-page learning-page">
      <div className="container">
        <div className="learning-heading">
          <span className="section-label">{course?.grade || 'الكورس'}</span>
          <h1>{course?.title || 'محتوى الكورس'}</h1>
        </div>
        <SecureVideoPlayer videos={result.results} viewerEmail={user.email} />
      </div>
    </main>
  );
}
