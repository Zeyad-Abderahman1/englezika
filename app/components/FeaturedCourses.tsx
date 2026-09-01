'use client';

import { useEffect, useState } from 'react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import CourseCard from './CourseCard';
import type { Course } from '../data/content';
import { useTranslation } from '../lib/i18n/use-translation';

export default function FeaturedCourses() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/courses', { signal: controller.signal, cache: 'no-store' })
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
        setCourses(loaded);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setCourses([]);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="courses-loading-state" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={32} />
        <span>{t('courses.loading')}</span>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="empty-state-card" role="status">
        <div className="empty-state-icon">
          <BookOpen size={36} />
        </div>
        <h3>{t('courses.empty_title')}</h3>
        <p>{t('courses.empty_desc')}</p>
      </div>
    );
  }

  return (
    <div className="course-grid">
      {courses.slice(0, 3).map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  );
}
