import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, Clock3, GraduationCap, ListChecks, Trophy } from 'lucide-react';
import { getDatabase } from '../../lib/platform';
import { getExamLeaderboard, getPublicExam } from '../../lib/public-exam';
import { formatDuration, ALL_GRADES_LABEL } from '../../lib/exam-listing';
import { getOptionalStudentEmail } from '../../lib/student-session';

/**
 * PUBLIC exam page (no login): description, facts and a top-10 leaderboard.
 * Only exams that are published AND listed as a course AND marked public are visible;
 * everything else is a 404. It never renders questions, options or answers.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExam(decodeURIComponent(slug));
  if (!exam) return { title: 'الامتحان غير موجود', robots: { index: false } };

  const description = exam.description || `امتحان ${exam.title} على منصة إنجليزيكا`;
  const image = exam.hasThumbnail ? [`/api/public/exams/${encodeURIComponent(exam.slug)}/thumbnail?v=${exam.updatedAt}`] : undefined;
  return {
    title: `${exam.title} | إنجليزيكا`,
    description,
    openGraph: { title: exam.title, description, locale: 'ar_EG', type: 'website', images: image },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: exam.title, description },
  };
}

function rankClass(rank: number) {
  return rank <= 3 ? `public-rank rank-${rank}` : 'public-rank';
}

export default async function PublicExamPage({ params }: Params) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const exam = await getPublicExam(slug);
  if (!exam) notFound();

  const leaderboardEnabled = exam.showLeaderboard && exam.mode === 'online';
  const leaderboard = leaderboardEnabled ? await getExamLeaderboard(exam.id) : [];

  // Logged-in visitors go straight to the normal exam / enrollment pages.
  const email = await getOptionalStudentEmail();
  let enrolled = false;
  if (email && exam.listingCourseId) {
    const row = await getDatabase()
      .prepare("SELECT id FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1")
      .bind(email, exam.listingCourseId)
      .first();
    enrolled = Boolean(row);
  }
  const returnTo = `/exams/${encodeURIComponent(exam.slug)}`;

  return (
    <main className="inner-page public-exam-page">
      <section className="section">
        <div className="container public-exam-layout">
          <article className="public-exam-main">
            <div className="public-exam-thumb">
              {exam.hasThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- fixed 16:9 box, served by our own cached route
                <img
                  src={`/api/public/exams/${encodeURIComponent(exam.slug)}/thumbnail?v=${exam.updatedAt}`}
                  alt={exam.title}
                  width={1280}
                  height={720}
                  loading="eager"
                />
              ) : (
                <div className="public-exam-thumb-fallback" aria-hidden="true">
                  <BookOpen size={44} />
                  <span>ENGLIZEKA</span>
                </div>
              )}
            </div>

            <span className="badge public-exam-badge">
              <GraduationCap size={14} aria-hidden="true" /> {ALL_GRADES_LABEL}
            </span>
            <h1>{exam.title}</h1>
            {exam.description && <p className="public-exam-description">{exam.description}</p>}

            <ul className="public-exam-facts" aria-label="تفاصيل الامتحان">
              <li>
                <ListChecks size={18} aria-hidden="true" />
                <span>عدد الأسئلة</span>
                <strong>{exam.questionCount}</strong>
              </li>
              <li>
                <Clock3 size={18} aria-hidden="true" />
                <span>المدة</span>
                <strong>{exam.durationMinutes} دقيقة</strong>
              </li>
              <li>
                <Trophy size={18} aria-hidden="true" />
                <span>درجة النجاح</span>
                <strong>{exam.passingScore}%</strong>
              </li>
            </ul>
          </article>

          <aside className="enroll-card public-exam-cta">
            <span>سعر الامتحان</span>
            <div className="big-price">
              {exam.price === 0 ? (
                'مجاني'
              ) : (
                <>
                  {exam.price} <small>جنيه</small>
                </>
              )}
            </div>
            {enrolled ? (
              <Link href={`/exam/${exam.id}`} className="btn btn-primary btn-large">
                ابدأ الامتحان
              </Link>
            ) : email && exam.listingCourseId ? (
              <Link href={`/subscribe/${exam.listingCourseId}`} className="btn btn-primary btn-large">
                {exam.price === 0 ? 'ابدأ مجانًا' : 'اشترك الآن'}
              </Link>
            ) : (
              <>
                <Link href={`/login?return_to=${encodeURIComponent(returnTo)}`} className="btn btn-primary btn-large">
                  سجّل الدخول للبدء
                </Link>
                <Link href="/register" className="btn btn-outline">
                  إنشاء حساب جديد
                </Link>
              </>
            )}
          </aside>
        </div>
      </section>

      {leaderboardEnabled && (
        <section className="section public-leaderboard-section" aria-labelledby="leaderboard-title">
          <div className="container">
            <h2 id="leaderboard-title">
              <Trophy size={22} aria-hidden="true" /> لوحة الأوائل — أفضل 10 طلاب
            </h2>
            {leaderboard.length === 0 ? (
              <p className="public-leaderboard-empty">لم يحل أحد هذا الامتحان بعد. كن أول المتصدرين!</p>
            ) : (
              <div className="public-leaderboard-scroll">
                <table className="public-leaderboard">
                  <caption className="public-visually-hidden">أفضل 10 طلاب في {exam.title}</caption>
                  <thead>
                    <tr>
                      <th scope="col">الترتيب</th>
                      <th scope="col">الطالب</th>
                      <th scope="col">الدرجة</th>
                      <th scope="col">النسبة</th>
                      <th scope="col">الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={row.rank} className={row.rank <= 3 ? `top-${row.rank}` : undefined}>
                        <td>
                          <span className={rankClass(row.rank)}>{row.rank}</span>
                        </td>
                        <td dir="auto">{row.displayName}</td>
                        <td>
                          {row.score} / {row.maxScore}
                        </td>
                        <td>{row.percentage}%</td>
                        <td dir="ltr">{formatDuration(row.timeSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
