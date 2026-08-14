import type { Metadata } from 'next';
import Link from 'next/link';
import { getDatabase } from '../../lib/platform';
import { isEmailVerified } from '../../lib/email-verification';
import SecureVideoPlayer from '../../components/SecureVideoPlayer';
import { requireStudentUser } from '../../lib/student-session';

export const metadata: Metadata = { title: 'مشاهدة الكورس' };
export const dynamic = 'force-dynamic';

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ video?: string | string[] }>;
}) {
  const { courseId } = await params;
  const requestedVideo = (await searchParams).video;
  const initialVideoId = typeof requestedVideo === 'string' ? requestedVideo.slice(0, 80) : undefined;
  const user = await requireStudentUser(`/learn/${courseId}`);
  const db = getDatabase();
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
  const grants = await db
    .prepare(
      `SELECT g.video_id AS videoId FROM student_video_access_grants g
       JOIN videos v ON v.id = g.video_id
       WHERE g.student_email = ? AND v.course_id = ? AND v.status = 'published'`
    )
    .bind(user.email.toLowerCase(), courseId)
    .all<{ videoId: string }>();
  if (!enrollment && grants.results.length === 0) {
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
     v.created_at AS createdAt
     FROM videos v
     WHERE v.course_id = ? AND v.status = 'published' ORDER BY v.created_at`
    )
    .bind(courseId)
    .all<{
      id: string;
      title: string;
      durationSeconds: number;
      createdAt: number;
    }>();
  const completed = await db
    .prepare(
      `SELECT p.video_id AS videoId FROM video_progress p
       JOIN videos v ON v.id = p.video_id
       WHERE p.user_email = ? AND v.course_id = ?`
    )
    .bind(user.email.toLowerCase(), courseId)
    .all<{ videoId: string }>();
  const completedIds = new Set(completed.results.map((item) => item.videoId));
  const grantedIds = new Set(grants.results.map((item) => item.videoId));
  const videos = result.results.map((video, index, allVideos) => ({
    ...video,
    completed: completedIds.has(video.id) ? 1 : 0,
    unlocked:
      grantedIds.has(video.id) ||
      (Boolean(enrollment) && (index === 0 || completedIds.has(allVideos[index - 1].id)))
        ? 1
        : 0,
  }));
  return (
    <main className="portal-page learning-page">
      <div className="container">
        <div className="learning-heading">
          <span className="section-label">{course?.grade || 'الكورس'}</span>
          <h1>{course?.title || 'محتوى الكورس'}</h1>
        </div>
        <SecureVideoPlayer
          videos={videos}
          viewerEmail={user.email}
          initialVideoId={initialVideoId}
          allowSequentialUnlock={Boolean(enrollment)}
        />
      </div>
    </main>
  );
}
