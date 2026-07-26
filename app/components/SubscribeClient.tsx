'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import PaymentFlow from './PaymentFlow';

type Course = { id: string; month: string; grade: string; price: number; lectures: number };

export default function SubscribeClient({ courseId }: { courseId: string }) {
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
        <LoaderCircle className="spin" /> جاري تحميل بيانات الاشتراك...
      </div>
    );
  return (
    <div className="container subscribe-grid">
      <aside className="order-summary">
        <span>ملخص الطلب</span>
        <h2>{course.month}</h2>
        <p>
          {course.grade} · {course.lectures || 'عدة'} محاضرات
        </p>
        <div>
          <span>الإجمالي</span>
          <strong>{course.price} جنيه</strong>
        </div>
      </aside>
      <PaymentFlow courseId={course.id} />
    </div>
  );
}
