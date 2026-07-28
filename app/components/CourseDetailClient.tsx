'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, FileText, LoaderCircle, Play, ShieldCheck } from 'lucide-react';

type Course = {
  id: string;
  month: string;
  grade: string;
  description: string;
  price: number;
  lectures: number;
  exams: number;
};

export default function CourseDetailClient({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch(`/api/courses/${courseId}`)
      .then(async (response) => {
        const data = (await response.json()) as { course?: Course; error?: string };
        if (!response.ok || !data.course) throw new Error(data.error || 'الكورس غير موجود');
        setCourse(data.course);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [courseId]);
  if (error) return <div className="dashboard-state error-toast">{error}</div>;
  if (!course)
    return (
      <div className="dashboard-state">
        <LoaderCircle className="spin" /> جاري تحميل الكورس...
      </div>
    );
  const lectures = [
    'شرح منظم للوحدة والقواعد الأساسية',
    'Vocabulary & Language Notes',
    'تدريب على أسئلة الامتحان',
    'حل شامل ومراجعة',
  ];
  return (
    <>
      <section className="course-detail-hero">
        <div className="container course-detail-grid">
          <div>
            <span className="badge">{course.grade}</span>
            <h1>{course.month}</h1>
            <p>
              {course.description ||
                'شرح كامل، تدريبات متدرجة، وملفات مراجعة تساعدك تقفل كل جزئية.'}
            </p>
            <ul className="include-list">
              <li>
                <Check /> {course.lectures || 'عدة'} محاضرات مسجلة
              </li>
              <li>
                <Check /> {course.exams || 'اختبارات'} بعد الدروس
              </li>
              <li>
                <Check /> مذكرات وملفات مراجعة
              </li>
              <li>
                <Check /> دعم ومتابعة مستمرة
              </li>
            </ul>
          </div>
          <aside className="enroll-card">
            <span>سعر الكورس</span>
            <div className="big-price">
              {course.price === 0 ? (
                'مجاني'
              ) : (
                <>
                  {course.price} <small>جنيه</small>
                </>
              )}
            </div>
            <Link href={`/subscribe/${course.id}`} className="btn btn-primary btn-large">
              {course.price === 0 ? 'ابدأ مجاناً' : 'اشترك دلوقتي'}
            </Link>
            <p>
              <ShieldCheck /> وصول آمن لمحتواك
            </p>
          </aside>
        </div>
      </section>
      <section className="section">
        <div className="container detail-content">
          <div>
            <div className="section-heading">
              <div>
                <span className="section-label">محتوى الكورس</span>
                <h2>المحاضرات</h2>
              </div>
            </div>
            <div className="lecture-list">
              {lectures.map((lecture, index) => (
                <div key={lecture}>
                  <span className="lecture-number">0{index + 1}</span>
                  <Play />
                  <strong>{lecture}</strong>
                  <ShieldCheck className="lock" />
                </div>
              ))}
            </div>
          </div>
          <div className="preview-box">
            <FileText />
            <h3>محتوى منظم وآمن</h3>
            <p>الفيديوهات والامتحانات تظهر على حسابك فور تفعيل الاشتراك.</p>
          </div>
        </div>
      </section>
    </>
  );
}
