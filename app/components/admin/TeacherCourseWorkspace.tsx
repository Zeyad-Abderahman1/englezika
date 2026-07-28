'use client';

import { useMemo, useState } from 'react';
import {
  BookOpen,
  ClipboardCheck,
  FileQuestion,
  PencilLine,
  PlaySquare,
  Search,
  Users,
} from 'lucide-react';

type Course = {
  id: string;
  title: string;
  grade: string;
  description: string;
  price: number;
  status: string;
};
type CourseItem = { courseId?: string | null };
type Enrollment = { courseId: string; status: string };

type Props = {
  courses: Course[];
  exams: CourseItem[];
  assignments: CourseItem[];
  videos: CourseItem[];
  enrollments: Enrollment[];
  canManageExams: boolean;
  canManageAssignments: boolean;
  canManageVideos: boolean;
  onEditCourse: (courseId: string) => void;
  onAddExam: (courseId: string) => void;
  onAddAssignment: (courseId: string) => void;
  onManageLessons: (courseId: string) => void;
};

export function TeacherCourseWorkspace({
  courses,
  exams,
  assignments,
  videos,
  enrollments,
  canManageExams,
  canManageAssignments,
  canManageVideos,
  onEditCourse,
  onAddExam,
  onAddAssignment,
  onManageLessons,
}: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'published' | 'draft'>('all');
  const visibleCourses = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return courses.filter(
      (course) =>
        (status === 'all' || course.status === status) &&
        (!normalized ||
          course.title.toLowerCase().includes(normalized) ||
          course.grade.toLowerCase().includes(normalized))
    );
  }, [courses, query, status]);

  const countFor = (items: CourseItem[], courseId: string) =>
    items.filter((item) => item.courseId === courseId).length;

  return (
    <section className="teacher-course-workspace">
      <header className="workspace-heading">
        <div>
          <span className="section-label">إدارة المحتوى بسرعة</span>
          <h2>مساحة عمل الكورسات</h2>
          <p>افتح أي كورس وأضف امتحاناً أو واجباً أو رتّب الامتحانات بين المحاضرات.</p>
        </div>
        <div className="workspace-filters">
          <label className="workspace-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث باسم الكورس أو الصف"
              aria-label="البحث في الكورسات"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            aria-label="تصفية الكورسات حسب الحالة"
          >
            <option value="all">كل الحالات</option>
            <option value="published">منشور</option>
            <option value="draft">مسودة</option>
          </select>
        </div>
      </header>

      <div className="teacher-course-grid">
        {visibleCourses.map((course) => {
          const examCount = countFor(exams, course.id);
          const assignmentCount = countFor(assignments, course.id);
          const lessonCount = countFor(videos, course.id);
          const studentCount = enrollments.filter(
            (item) => item.courseId === course.id && item.status === 'approved'
          ).length;
          return (
            <article key={course.id} className="teacher-course-card">
              <div className="teacher-course-card-head">
                <span className="teacher-course-icon">
                  <BookOpen />
                </span>
                <span
                  className={`status-pill status-${course.status === 'published' ? 'approved' : 'pending'}`}
                >
                  {course.status === 'published' ? 'منشور' : 'مسودة'}
                </span>
              </div>
              <div className="teacher-course-copy">
                <small>{course.grade}</small>
                <h3>{course.title}</h3>
                <p>{course.description || 'لا يوجد وصف للكورس حتى الآن.'}</p>
              </div>
              <div className="teacher-course-metrics">
                <span>
                  <PlaySquare />
                  <b>{lessonCount}</b>
                  <small>محاضرة</small>
                </span>
                <span>
                  <FileQuestion />
                  <b>{examCount}</b>
                  <small>امتحان</small>
                </span>
                <span>
                  <ClipboardCheck />
                  <b>{assignmentCount}</b>
                  <small>واجب</small>
                </span>
                <span>
                  <Users />
                  <b>{studentCount}</b>
                  <small>طالب</small>
                </span>
              </div>
              <div className="teacher-course-actions">
                <button className="btn btn-primary" onClick={() => onEditCourse(course.id)}>
                  <PencilLine /> إدارة الكورس
                </button>
                {canManageExams && (
                  <button className="btn btn-outline" onClick={() => onAddExam(course.id)}>
                    <FileQuestion /> امتحان
                  </button>
                )}
                {canManageAssignments && (
                  <button className="btn btn-outline" onClick={() => onAddAssignment(course.id)}>
                    <ClipboardCheck /> واجب
                  </button>
                )}
                {canManageVideos && (
                  <button className="btn btn-outline" onClick={() => onManageLessons(course.id)}>
                    <PlaySquare /> المحاضرات
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!visibleCourses.length && (
          <div className="workspace-empty">
            <Search />
            <strong>لا توجد كورسات مطابقة</strong>
            <span>جرّب تغيير البحث أو حالة النشر.</span>
          </div>
        )}
      </div>
    </section>
  );
}
