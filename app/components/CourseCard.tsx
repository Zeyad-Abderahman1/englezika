import Link from 'next/link';
import { BookOpen, Clock3, GraduationCap } from 'lucide-react';
import type { Course } from '../data/content';

export default function CourseCard({ course }: { course: Course }) {
  return (
    <article className={`course-card ${course.popular ? 'featured' : ''}`}>
      <div className="course-card-artwork">
        {course.thumbnailKey ? (
          <img
            src={`/api/courses/${course.id}/thumbnail`}
            alt={course.month}
            className="course-card-thumb-img"
            loading="lazy"
          />
        ) : (
          <div className="course-card-fallback">
            <span className="course-card-fallback-glow" />
            <BookOpen className="course-card-fallback-icon" />
            <span className="course-card-fallback-brand">ENGLIZEKA</span>
          </div>
        )}
        {course.badge && (
          <span className={`badge course-artwork-badge ${course.badge === 'جديد' ? 'new' : ''}`}>
            {course.badge}
          </span>
        )}
      </div>
      <p className="course-kicker">English Course</p>
      <h3>{course.month}</h3>
      <div className="course-meta">
        <span>
          <GraduationCap />
          {course.grade}
        </span>
        <span>
          <Clock3 />
          {course.lectures} محاضرات
        </span>
      </div>
      <div className="course-bottom">
        <div className="price">
          <strong>{course.price === 0 ? 'مجاني' : course.price}</strong>
          {course.price !== 0 && <span>جنيه</span>}
        </div>
        {course.available ? (
          <Link className="btn btn-primary" href={`/course/${course.id}`}>
            التفاصيل والاشتراك
          </Link>
        ) : (
          <button className="btn btn-disabled" disabled>
            متاح قريباً
          </button>
        )}
      </div>
    </article>
  );
}
