/**
 * app/components/admin/AdminCourseList.tsx
 *
 * Courses tab: add-course form + list of all courses with delete.
 * Extracted from AdminDashboard.tsx.
 */

'use client';

import { useState } from 'react';
import { BookOpen, CirclePlus, PencilLine, Save, Trash2 } from 'lucide-react';

type Course = {
  id: string;
  title: string;
  grade: string;
  description: string;
  price: number;
  status: string;
};

interface AdminCourseListProps {
  courses: Course[];
  focusedCourseId?: string;
  busy: boolean;
  onAddCourse: (values: Record<string, string>, resetForm: () => void) => void;
  onEditCourse: (id: string, values: Record<string, string>) => void;
  onAddExam: (courseId: string) => void;
  onAddAssignment: (courseId: string) => void;
  onManageLessonGates: (courseId: string) => void;
  onDeleteCourse: (id: string) => void;
}

export function AdminCourseList({
  courses,
  focusedCourseId,
  busy,
  onAddCourse,
  onEditCourse,
  onAddExam,
  onAddAssignment,
  onManageLessonGates,
  onDeleteCourse,
}: AdminCourseListProps) {
  const [openCourseId, setOpenCourseId] = useState(focusedCourseId || '');
  return (
    <div className="admin-split">
      {/* ── Add course form ─────────────────────────────────────── */}
      <section className="dashboard-panel">
        <div className="panel-title">
          <CirclePlus />
          <div>
            <h2>إضافة كورس</h2>
            <p>أنشئ كورساً واربط به الفيديوهات والامتحانات</p>
          </div>
        </div>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
            onAddCourse(values, () => form.reset());
          }}
        >
          <label>
            اسم الكورس
            <input name="title" required />
          </label>
          <label>
            الصف
            <select name="grade" required>
              <option value="">اختر الصف</option>
              <option>أولى ثانوي</option>
              <option>تانية ثانوي</option>
              <option>تالتة ثانوي</option>
              <option>كل الصفوف</option>
            </select>
          </label>
          <label>
            الوصف
            <textarea name="description" rows={4} />
          </label>
          <div className="form-row">
            <label>
              السعر
              <input name="price" type="number" min="0" defaultValue="0" />
            </label>
            <label>
              الحالة
              <select name="status">
                <option value="draft">مسودة</option>
                <option value="published">منشور</option>
              </select>
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            <Save /> حفظ الكورس
          </button>
        </form>
      </section>

      {/* ── Course list ──────────────────────────────────────────── */}
      <section className="dashboard-panel wide-panel">
        <div className="panel-title">
          <BookOpen />
          <div>
            <h2>كل الكورسات</h2>
            <p>{courses.length} كورس</p>
          </div>
        </div>
        <div className="management-list">
          {courses.map((course) => (
            <article
              key={course.id}
              className={course.id === focusedCourseId ? 'focused-course' : undefined}
            >
              <div>
                <strong>{course.title}</strong>
                <small>
                  {course.grade} · {course.price} جنيه
                </small>
                <p>{course.description}</p>
              </div>
              <div className="list-actions">
                <span
                  className={`status-pill status-${course.status === 'published' ? 'approved' : 'pending'}`}
                >
                  {course.status === 'published' ? 'منشور' : 'مسودة'}
                </span>
                <details
                  open={openCourseId === course.id}
                  onToggle={(event) => {
                    if (event.currentTarget.open) setOpenCourseId(course.id);
                    else if (openCourseId === course.id) setOpenCourseId('');
                  }}
                >
                  <summary className="icon-button" aria-label="تعديل الكورس">
                    <PencilLine />
                  </summary>
                  <form
                    className="stack-form dashboard-popover-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = Object.fromEntries(
                        new FormData(event.currentTarget)
                      ) as Record<string, string>;
                      onEditCourse(course.id, values);
                    }}
                  >
                    <label>
                      اسم الكورس
                      <input name="title" defaultValue={course.title} required />
                    </label>
                    <label>
                      الصف
                      <select name="grade" defaultValue={course.grade} required>
                        <option>أولى ثانوي</option>
                        <option>تانية ثانوي</option>
                        <option>تالتة ثانوي</option>
                        <option>كل الصفوف</option>
                      </select>
                    </label>
                    <label>
                      الوصف
                      <textarea name="description" rows={3} defaultValue={course.description} />
                    </label>
                    <div className="form-row">
                      <label>
                        السعر
                        <input name="price" type="number" min="0" defaultValue={course.price} />
                      </label>
                      <label>
                        الحالة
                        <select name="status" defaultValue={course.status}>
                          <option value="draft">مسودة</option>
                          <option value="published">منشور</option>
                        </select>
                      </label>
                    </div>
                    <button className="btn btn-primary" disabled={busy}>
                      <Save /> حفظ التعديلات
                    </button>
                    <div className="course-content-actions">
                      <strong>إضافة محتوى لهذا الكورس</strong>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onAddExam(course.id)}
                      >
                        إضافة امتحان ونسبة نجاح
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onAddAssignment(course.id)}
                      >
                        إضافة واجب
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => onManageLessonGates(course.id)}
                      >
                        وضع امتحان بين المحاضرات
                      </button>
                    </div>
                  </form>
                </details>
                <button
                  className="icon-button danger"
                  aria-label="حذف"
                  disabled={busy}
                  onClick={() => onDeleteCourse(course.id)}
                >
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
