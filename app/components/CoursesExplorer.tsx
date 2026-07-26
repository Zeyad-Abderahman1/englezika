'use client';

import { useEffect, useMemo, useState } from 'react';
import { courses as fallbackCourses, type Course } from '../data/content';
import CourseCard from './CourseCard';

const filters = ['الكل', 'أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];

export default function CoursesExplorer() {
  const [active, setActive] = useState('الكل');
  const [courses, setCourses] = useState<Course[]>(fallbackCourses);

  useEffect(() => {
    void fetch('/api/courses')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ courses?: Array<Record<string, unknown>> }>)
          : Promise.reject()
      )
      .then((data) => {
        const loaded = (data.courses ?? []).map((course) => ({
          id: String(course.id),
          month: String(course.month),
          grade: String(course.grade),
          lectures: Number(course.lectures) || 0,
          price: Number(course.price) || 0,
          available: Boolean(course.available),
        }));
        if (loaded.length) setCourses(loaded);
      })
      .catch(() => undefined);
  }, []);

  const visible = useMemo(
    () => (active === 'الكل' ? courses : courses.filter((course) => course.grade === active)),
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
      <div className="course-grid">
        {visible.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}
      </div>
    </>
  );
}
