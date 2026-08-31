import type { Metadata } from 'next';
import Link from 'next/link';
import { getDatabase } from '../../lib/platform';
import { isEmailVerified } from '../../lib/email-verification';
import SecureVideoPlayer, { type Video } from '../../components/SecureVideoPlayer';
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
  const normalizedEmail = user.email.toLowerCase();

  if (!(await isEmailVerified(normalizedEmail))) {
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
    .bind(normalizedEmail, courseId)
    .first();

  const grants = await db
    .prepare(
      `SELECT g.video_id AS videoId FROM student_video_access_grants g
       JOIN videos v ON v.id = g.video_id
       WHERE g.student_email = ? AND v.course_id = ? AND v.status = 'published'`
    )
    .bind(normalizedEmail, courseId)
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

  // Fetch videos in sequential order with prerequisite exam data
  const result = await db
    .prepare(
      `SELECT v.id, v.title, v.duration_seconds AS durationSeconds,
              v.prerequisite_exam_id AS prerequisiteExamId, v.minimum_score AS minimumScore,
              v.created_at AS createdAt,
              x.title AS prerequisiteExamTitle, x.passing_score AS examPassingScore
       FROM videos v
       LEFT JOIN exams x ON x.id = v.prerequisite_exam_id
       WHERE v.course_id = ? AND v.status = 'published'
       ORDER BY v.created_at`
    )
    .bind(courseId)
    .all<{
      id: string;
      title: string;
      durationSeconds: number;
      prerequisiteExamId: string | null;
      minimumScore: number;
      createdAt: number;
      prerequisiteExamTitle: string | null;
      examPassingScore: number | null;
    }>();

  // Fetch user video completions
  const completed = await db
    .prepare(
      `SELECT p.video_id AS videoId FROM video_progress p
       JOIN videos v ON v.id = p.video_id
       WHERE p.user_email = ? AND v.course_id = ?`
    )
    .bind(normalizedEmail, courseId)
    .all<{ videoId: string }>();

  // Fetch user exam attempt best percentages
  const examAttempts = await db
    .prepare(
      `SELECT a.exam_id AS examId,
              MAX(CASE WHEN a.max_score > 0 THEN (a.score * 100.0 / a.max_score) ELSE 0 END) AS bestPercentage
       FROM attempts a
       WHERE a.user_email = ? AND a.status = 'submitted'
       GROUP BY a.exam_id`
    )
    .bind(normalizedEmail)
    .all<{ examId: string; bestPercentage: number }>();

  const completedIds = new Set(completed.results.map((item) => item.videoId));
  const grantedIds = new Set(grants.results.map((item) => item.videoId));
  const examScoresMap = new Map(examAttempts.results.map((r) => [r.examId, Number(r.bestPercentage)]));

  const videos: Video[] = result.results.map((video, index, allVideos) => {
    const hasGrant = grantedIds.has(video.id);
    const isCompleted = completedIds.has(video.id);
    const prevCompleted = index === 0 || completedIds.has(allVideos[index - 1].id);

    let prerequisiteExam = null;
    let examPassed = true;

    if (video.prerequisiteExamId && video.prerequisiteExamTitle) {
      const best = examScoresMap.has(video.prerequisiteExamId)
        ? examScoresMap.get(video.prerequisiteExamId)!
        : null;
      const minRequired = Number(video.minimumScore || 0);
      const passed = best !== null && best >= minRequired;
      if (!hasGrant && !passed) {
        examPassed = false;
      }
      prerequisiteExam = {
        id: video.prerequisiteExamId,
        title: video.prerequisiteExamTitle,
        minimumScore: minRequired,
        bestPercentage: best !== null ? Math.round(best) : null,
        passed,
      };
    }

    let unlocked = 0;
    let lockReason: 'previous_lesson' | 'prerequisite_exam' | null = null;

    if (hasGrant) {
      unlocked = 1;
    } else if (Boolean(enrollment)) {
      if (!prevCompleted) {
        unlocked = 0;
        lockReason = 'previous_lesson';
      } else if (!examPassed) {
        unlocked = 0;
        lockReason = 'prerequisite_exam';
      } else {
        unlocked = 1;
      }
    }

    return {
      id: video.id,
      title: video.title,
      durationSeconds: video.durationSeconds,
      completed: isCompleted ? 1 : 0,
      unlocked,
      prerequisiteExam,
      lockReason,
    };
  });

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
