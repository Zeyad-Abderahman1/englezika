'use client';

import { useEffect, useState } from 'react';
import CourseCard from './CourseCard';
import { courses as fallbackCourses, type Course } from '../data/content';

export default function FeaturedCourses() {
  const [courses, setCourses] = useState<Course[]>(fallbackCourses);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/courses', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load courses');
        return (await response.json()) as { courses?: Array<Record<string, unknown>> };
      })
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
    return () => controller.abort();
  }, []);

  return (
    <div className="course-grid">
      {courses.slice(0, 3).map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  );
}
