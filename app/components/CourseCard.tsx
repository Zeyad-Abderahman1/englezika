import Link from 'next/link';
import { BookOpen, Clock3, GraduationCap } from 'lucide-react';
import type { Course } from '../data/content';

export default function CourseCard({ course }: { course: Course }) {
  return (
    <article className={`course-card ${course.popular ? 'featured' : ''}`}>
      <div className="course-card-head">
        {course.badge && (
          <span className={`badge ${course.badge === 'جديد' ? 'new' : ''}`}>{course.badge}</span>
        )}
        <span className="course-icon">
          <BookOpen />
        </span>
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
          <strong>{course.price}</strong>
          <span>جنيه</span>
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
