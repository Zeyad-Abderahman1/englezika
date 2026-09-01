'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import type { Course } from '../data/content';
import CourseCard from './CourseCard';
import { useTranslation } from '../lib/i18n/use-translation';

export default function CoursesExplorer() {
  const { t } = useTranslation();
  const [active, setActive] = useState<'all' | 'g1' | 'g2' | 'g3'>('all');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const filters = [
    { key: 'all' as const, label: t('courses.filter_all') },
    { key: 'g1' as const, label: t('courses.filter_g1'), arabicGrade: 'أولى ثانوي' },
    { key: 'g2' as const, label: t('courses.filter_g2'), arabicGrade: 'تانية ثانوي' },
    { key: 'g3' as const, label: t('courses.filter_g3'), arabicGrade: 'تالتة ثانوي' },
  ];

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

  const visible = useMemo(() => {
    if (active === 'all') return courses;
    const selectedFilter = filters.find((f) => f.key === active);
    if (!selectedFilter || !selectedFilter.arabicGrade) return courses;
    return courses.filter((course) =>
      course.grade.includes(selectedFilter.arabicGrade) ||
      (active === 'g1' && course.grade.includes('الأول')) ||
      (active === 'g2' && course.grade.includes('الثاني')) ||
      (active === 'g3' && course.grade.includes('الثالث'))
    );
  }, [active, courses, filters]);

  return (
    <>
      <div className="filter-tabs" role="tablist" aria-label={t('courses.hero_title')}>
        {filters.map((filter) => (
          <button
            key={filter.key}
            role="tab"
            aria-selected={active === filter.key}
            className={active === filter.key ? 'active' : ''}
            onClick={() => setActive(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="courses-loading-state" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={32} />
          <span>{t('courses.loading')}</span>
        </div>
      ) : courses.length === 0 ? (
        <div className="empty-state-card" role="status">
          <div className="empty-state-icon">
            <BookOpen size={36} />
          </div>
          <h3>{t('courses.empty_title')}</h3>
          <p>{t('courses.empty_desc')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state-card" role="status">
          <div className="empty-state-icon">
            <BookOpen size={36} />
          </div>
          <h3>{t('courses.empty_filter_title')}</h3>
          <p>{t('courses.empty_filter_desc')}</p>
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
