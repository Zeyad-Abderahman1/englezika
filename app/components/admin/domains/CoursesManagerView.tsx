'use client';

/**
 * app/components/admin/domains/CoursesManagerView.tsx
 *
 * Dedicated Courses domain management page (/admin/courses):
 * - Search by title and grade
 * - Filter by status (published/draft) and grade level
 * - Add course modal / slide-over form
 * - Comprehensive courses catalog table/cards with status badges
 * - Edit course modal
 * - Content shortcuts: Add exam, add assignment, manage lecture gates
 * - Delete course with dependency conflict guard handling
 */

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  CirclePlus,
  FileQuestion,
  PencilLine,
  PlaySquare,
  ClipboardCheck,
  Save,
  Trash2,
  X,
  ListOrdered,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Course } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import CourseSequenceManager from '../CourseSequenceManager';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';

export function CoursesManagerView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedIdFromUrl = searchParams.get('focus') || '';

  const { data, busy, mutate, openConfirm, can } = useAdmin();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [sequenceCourse, setSequenceCourse] = useState<Course | null>(null);

  const courses = useMemo(() => data?.courses || [], [data?.courses]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((course) => {
      const matchSearch =
        !q ||
        course.title.toLowerCase().includes(q) ||
        course.grade.toLowerCase().includes(q) ||
        (course.description && course.description.toLowerCase().includes(q));
      const matchStatus = statusFilter === 'all' || course.status === statusFilter;
      const matchGrade = gradeFilter === 'all' || course.grade === gradeFilter;
      return matchSearch && matchStatus && matchGrade;
    });
  }, [courses, search, statusFilter, gradeFilter]);

  const handleAddCourse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;

    const ok = await mutate(
      () =>
        adminApiRequest('/api/admin/courses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: values.title,
            grade: values.grade,
            description: values.description || '',
            price: Number(values.price) || 0,
            status: values.status || 'published',
          }),
        }),
      'تم إنشاء الكورس بنجاح'
    );

    if (ok) {
      form.reset();
      setIsAddOpen(false);
    }
  };

  const handleEditCourse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingCourse) return;
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/courses/${editingCourse.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: values.title,
            grade: values.grade,
            description: values.description || '',
            price: Number(values.price) || 0,
            status: values.status || 'published',
          }),
        }),
      'تم تحديث بيانات الكورس بنجاح'
    );

    if (ok) {
      setEditingCourse(null);
    }
  };

  const handleDeleteCourse = (course: Course) => {
    openConfirm({
      title: `حذف كورس «${course.title}»`,
      message:
        'هل أنت متأكد من رغبتك في حذف هذا الكورس؟ لن تتمكن من حذفه إذا كان مرتبطًا بطلاب مشتركين أو امتحانات أو محاضرات.',
      confirmLabel: 'تأكيد حذف الكورس',
      isDestructive: true,
      onConfirm: async () => {
        await mutate(
          () => adminApiRequest(`/api/admin/courses/${course.id}`, { method: 'DELETE' }),
          'تم حذف الكورس بنجاح'
        );
      },
    });
  };

  return (
    <div className="admin-courses-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="الكورسات التعليمية"
        description="إدارة الكورسات، تحديد الأسعار والصفوف الدراسية، وإدارة المحتوى المرتبط."
        breadcrumbs={[{ label: 'الكورسات' }]}
        badge={
          <span className="admin-header-pill">
            <BookOpen size={14} /> {courses.length} كورس
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsAddOpen(true)}
          >
            <CirclePlus size={16} /> إضافة كورس جديد
          </button>
        }
      />

      {/* ── Filter Toolbar ─────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم الكورس أو الصف أو الوصف..."
        resultCount={filteredCourses.length}
        onClearFilters={() => {
          setSearch('');
          setStatusFilter('all');
          setGradeFilter('all');
        }}
        filters={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="admin-select"
              aria-label="تصفية الكورسات حسب الحالة"
            >
              <option value="all">كل الحالات</option>
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
            </select>

            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="admin-select"
              aria-label="تصفية الكورسات حسب الصف"
            >
              <option value="all">كل الصفوف</option>
              <option value="أولى ثانوي">أولى ثانوي</option>
              <option value="تانية ثانوي">تانية ثانوي</option>
              <option value="تالتة ثانوي">تالتة ثانوي</option>
              <option value="كل الصفوف">كل الصفوف</option>
              <option value="أخرى">أخرى</option>
            </select>
          </>
        }
      />

      {/* ── Course Catalog List / Cards ────────────────────────────────────── */}
      {filteredCourses.length === 0 ? (
        <AdminEmptyState
          icon={BookOpen}
          title="لا توجد كورسات مطابقة"
          description={
            search || statusFilter !== 'all' || gradeFilter !== 'all'
              ? 'جرّب تعديل معايير البحث والتصفية لعرض النتائج.'
              : 'لم تقم بإنشاء أي كورس بعد. انقر على الزر أدناه لإضافة أول كورس.'
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsAddOpen(true)}
            >
              <CirclePlus size={16} /> إنشاء كورس جديد
            </button>
          }
        />
      ) : (
        <div className="admin-courses-grid">
          {filteredCourses.map((course) => {
            const isFocused = course.id === focusedIdFromUrl;
            return (
              <article
                key={course.id}
                className={`admin-course-card ${isFocused ? 'is-focused' : ''}`}
              >
                <div className="admin-course-card-top">
                  <span className="admin-course-grade-tag">{course.grade}</span>
                  <AdminStatusBadge status={course.status} />
                </div>

                <div className="admin-course-card-content">
                  <h3 className="admin-course-title">{course.title}</h3>
                  <p className="admin-course-description">
                    {course.description || 'لا يوجد وصف مخصص لهذا الكورس.'}
                  </p>
                  <div className="admin-course-price">
                    <span className="price-number">{course.price}</span>
                    <span className="price-currency">جنيه مصري</span>
                  </div>
                </div>

                {/* Content shortcuts */}
                <div className="admin-course-shortcuts">
                  {can('manage_exams') && (
                    <button
                      type="button"
                      className="shortcut-link"
                      onClick={() => router.push(`/admin/exams?courseId=${course.id}`)}
                      title="إضافة أو استعراض امتحانات الكورس"
                    >
                      <FileQuestion size={14} /> امتحانات
                    </button>
                  )}
                  {can('manage_assignments') && (
                    <button
                      type="button"
                      className="shortcut-link"
                      onClick={() => router.push(`/admin/assignments?courseId=${course.id}`)}
                      title="إضافة أو استعراض واجبات الكورس"
                    >
                      <ClipboardCheck size={14} /> واجبات
                    </button>
                  )}
                  {can('manage_videos') && (
                    <button
                      type="button"
                      className="shortcut-link"
                      onClick={() => router.push(`/admin/lectures?courseId=${course.id}`)}
                      title="إدارة محاضرات وترتيب الفيديوهات"
                    >
                      <PlaySquare size={14} /> محاضرات
                    </button>
                  )}
                  {can('manage_courses') && (
                    <button
                      type="button"
                      className="shortcut-link"
                      onClick={() => setSequenceCourse(course)}
                      title="إدارة تسلسل محتوى الكورس"
                    >
                      <ListOrdered size={14} /> التسلسل
                    </button>
                  )}
                </div>

                {/* Primary Card Actions */}
                <div className="admin-course-card-footer">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setEditingCourse(course)}
                  >
                    <PencilLine size={14} /> تعديل الكورس
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon text-danger"
                    onClick={() => handleDeleteCourse(course)}
                    title="حذف الكورس"
                    aria-label={`حذف كورس ${course.title}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ── Add Course Modal ───────────────────────────────────────────────── */}
      {isAddOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-course-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="add-course-title" className="admin-modal-title">
                إضافة كورس جديد
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setIsAddOpen(false)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleAddCourse}>
              <label className="admin-field-label">
                <span>اسم الكورس <span className="text-danger">*</span></span>
                <input
                  name="title"
                  required
                  minLength={3}
                  placeholder="مثال: لغة إنجليزية — الصف الثالث الثانوي (مراجعة نهائية)"
                  className="admin-input"
                />
              </label>

              <div className="admin-form-row">
                <label className="admin-field-label">
                  <span>الصف الدراسي <span className="text-danger">*</span></span>
                  <select name="grade" required className="admin-select">
                    <option value="">اختر الصف</option>
                    <option value="أولى ثانوي">أولى ثانوي</option>
                    <option value="تانية ثانوي">تانية ثانوي</option>
                    <option value="تالتة ثانوي">تالتة ثانوي</option>
                    <option value="كل الصفوف">كل الصفوف</option>
                    <option value="أخرى">أخرى</option>
                  </select>
                </label>

                <label className="admin-field-label">
                  <span>السعر (بالجنيه) <span className="text-danger">*</span></span>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    max="100000"
                    defaultValue="0"
                    required
                    className="admin-input"
                  />
                </label>
              </div>

              <label className="admin-field-label">
                <span>وصف الكورس</span>
                <textarea
                  name="description"
                  rows={4}
                  placeholder="اكتب نبذة عن موضوعات الكورس وما سيتعلمه الطالب..."
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>حالة النشر</span>
                <select name="status" defaultValue="published" className="admin-select">
                  <option value="published">منشور فورًا</option>
                  <option value="draft">مسودة (غير مرئي للطلاب)</option>
                </select>
              </label>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsAddOpen(false)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> حفظ وإنشاء الكورس
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Course Modal ──────────────────────────────────────────────── */}
      {editingCourse && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-course-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingCourse(null);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="edit-course-title" className="admin-modal-title">
                تعديل كورس «{editingCourse.title}»
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setEditingCourse(null)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleEditCourse}>
              <label className="admin-field-label">
                <span>اسم الكورس <span className="text-danger">*</span></span>
                <input
                  name="title"
                  defaultValue={editingCourse.title}
                  required
                  minLength={3}
                  className="admin-input"
                />
              </label>

              <div className="admin-form-row">
                <label className="admin-field-label">
                  <span>الصف الدراسي <span className="text-danger">*</span></span>
                  <select
                    name="grade"
                    defaultValue={editingCourse.grade}
                    required
                    className="admin-select"
                  >
                    <option value="أولى ثانوي">أولى ثانوي</option>
                    <option value="تانية ثانوي">تانية ثانوي</option>
                    <option value="تالتة ثانوي">تالتة ثانوي</option>
                    <option value="كل الصفوف">كل الصفوف</option>
                    <option value="أخرى">أخرى</option>
                  </select>
                </label>

                <label className="admin-field-label">
                  <span>السعر (بالجنيه) <span className="text-danger">*</span></span>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    max="100000"
                    defaultValue={editingCourse.price}
                    required
                    className="admin-input"
                  />
                </label>
              </div>

              <label className="admin-field-label">
                <span>وصف الكورس</span>
                <textarea
                  name="description"
                  rows={4}
                  defaultValue={editingCourse.description}
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>حالة النشر</span>
                <select
                  name="status"
                  defaultValue={editingCourse.status}
                  className="admin-select"
                >
                  <option value="published">منشور</option>
                  <option value="draft">مسودة</option>
                </select>
              </label>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingCourse(null)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> حفظ التعديلات
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ── Sequence Manager Modal ─────────────────────────────────────────────── */}
      {sequenceCourse && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seq-manager-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSequenceCourse(null);
          }}
        >
          <div className="admin-modal-card wide-modal">
            <header className="admin-modal-header">
              <h3 id="seq-manager-title" className="admin-modal-title">
                تسلسل المحتوى
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSequenceCourse(null)}
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </header>
            <CourseSequenceManager
              courseId={sequenceCourse.id}
              courseTitle={sequenceCourse.title}
              initialItems={[]}
              availableVideos={(data?.videos || [])
                .filter((v) => v.courseId === sequenceCourse.id)
                .map((v) => ({
                  id: v.id,
                  type: 'video' as const,
                  title: v.title,
                }))}
              availableExams={(data?.exams || [])
                .filter((e) => e.courseId === sequenceCourse.id)
                .map((e) => ({
                  id: e.id,
                  type: 'exam' as const,
                  title: e.title,
                }))}
              availableAssignments={(data?.assignments || [])
                .filter((a) => a.courseId === sequenceCourse.id)
                .map((a) => ({
                  id: a.id,
                  type: 'assignment' as const,
                  title: a.title,
                }))}
              onSaved={() => { setSequenceCourse(null); }}
              onClose={() => setSequenceCourse(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
