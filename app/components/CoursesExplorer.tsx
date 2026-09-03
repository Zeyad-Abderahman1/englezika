'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import type { Course } from '../data/content';
import CourseCard from './CourseCard';

const filters = ['الكل', 'أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي', 'أخرى'];

export default function CoursesExplorer() {
  const [active, setActive] = useState('الكل');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    fetch('/api/courses', { cache: 'no-store' })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ courses?: Array<Record<string, unknown>> }>)
          : Promise.reject()
      )
      .then((data) => {
        if (!isMounted) return;
        const loaded = (data.courses ?? []).map((course) => ({
          id: String(course.id),
          month: String(course.month),
          grade: String(course.grade),
          lectures: Number(course.lectures) || 0,
          price: Number(course.price) || 0,
          available: Boolean(course.available),
        }));
        setCourses(loaded);
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setCourses([]);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const standardGrades = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];
  const visible = useMemo(
    () =>
      active === 'الكل'
        ? courses
        : active === 'أخرى'
          ? courses.filter((course) => !standardGrades.includes(course.grade))
          : courses.filter((course) => course.grade === active),
    [active, courses]
  );

  return (
    <>
      <div className="filter-tabs" role="tablist" aria-label="تصفية الكورسات">
        {filters.map((filter) => (
          <button
            key={filter}
            role="tab"
            aria-selected={active === filter}
            className={active === filter ? 'active' : ''}
            onClick={() => setActive(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="courses-loading-state" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={32} />
          <span>جاري تحميل الكورسات...</span>
        </div>
      ) : courses.length === 0 ? (
        <div className="empty-state-card" role="status">
          <div className="empty-state-icon">
            <BookOpen size={36} />
          </div>
          <h3>لا توجد كورسات متاحة حالياً</h3>
          <p>سيتم إضافة الكورسات الجديدة قريباً.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state-card" role="status">
          <div className="empty-state-icon">
            <BookOpen size={36} />
          </div>
          <h3>لا توجد كورسات متاحة لهذا الصف حالياً</h3>
          <p>جرب اختيار صف دراسي آخر أو تصفح كل الكورسات.</p>
        </div>
      ) : (
        <div className="course-grid">
          {visible.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </>
  );
}

