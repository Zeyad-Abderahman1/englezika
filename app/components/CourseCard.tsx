'use client';

import Link from 'next/link';
import { BookOpen, Clock3, GraduationCap } from 'lucide-react';
import type { Course } from '../data/content';
import { useTranslation } from '../lib/i18n/use-translation';

export default function CourseCard({ course }: { course: Course }) {
  const { t, language } = useTranslation();

  return (
    <article className={`course-card ${course.popular ? 'featured' : ''}`}>
      <div className="course-card-head">
        {course.badge && (
          <span className={`badge ${course.badge === 'جديد' ? 'new' : ''}`}>
            {language === 'en' && course.badge === 'جديد' ? 'NEW' : course.badge}
          </span>
        )}
        <span className="course-icon">
          <BookOpen size={20} />
        </span>
      </div>
      <p className="course-kicker">English Course</p>
      <h3>{course.month}</h3>
      <div className="course-meta">
        <span>
          <GraduationCap size={16} />
          {course.grade}
        </span>
        <span>
          <Clock3 size={16} />
          {course.lectures} {t('courses.lectures_count')}
        </span>
      </div>
      <div className="course-bottom">
        <div className="price">
          <strong>{course.price === 0 ? t('courses.free') : course.price}</strong>
          {course.price !== 0 && <span>{t('courses.currency')}</span>}
        </div>
        {course.available ? (
          <Link className="btn btn-primary" href={`/course/${course.id}`}>
            {t('courses.details')}
          </Link>
        ) : (
          <button className="btn btn-disabled" disabled>
            {language === 'en' ? 'Coming Soon' : 'متاح قريباً'}
          </button>
        )}
      </div>
    </article>
  );
}
