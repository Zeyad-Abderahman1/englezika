'use client';

import { ClipboardCheck, PencilLine, Save, Trash2 } from 'lucide-react';

type Course = { id: string; title: string };
type Assignment = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  description: string;
  dueAt?: number | null;
  maxScore: number;
  status: string;
};

type Props = {
  assignments: Assignment[];
  courses: Course[];
  defaultCourseId?: string;
  busy: boolean;
  onAdd: (values: Record<string, unknown>, reset: () => void) => void;
  onEdit: (id: string, values: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
};

function formValues(form: HTMLFormElement): Record<string, unknown> {
  const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
  return { ...values, dueAt: values.dueAt ? new Date(values.dueAt).getTime() : null };
}

function dateTimeValue(timestamp?: number | null): string {
  if (!timestamp) return '';
  const offset = new Date(timestamp).getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

export function AdminAssignmentList({
  assignments,
  courses,
  defaultCourseId = '',
  busy,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div className="admin-split">
      <section className="dashboard-panel">
        <div className="panel-title">
          <ClipboardCheck />
          <div>
            <h2>إضافة واجب</h2>
            <p>أضف واجباً للطلاب المسجلين في كورس محدد</p>
          </div>
        </div>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            onAdd(formValues(form), () => form.reset());
          }}
        >
          <label>
            الكورس
            <select name="courseId" defaultValue={defaultCourseId} required>
              <option value="">اختر الكورس</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            عنوان الواجب
            <input name="title" required maxLength={150} />
          </label>
          <label>
            التفاصيل
            <textarea name="description" rows={5} maxLength={3000} />
          </label>
          <div className="form-row">
            <label>
              موعد التسليم
              <input name="dueAt" type="datetime-local" />
            </label>
            <label>
              الدرجة
              <input name="maxScore" type="number" min="0" max="10000" defaultValue="0" />
            </label>
          </div>
          <label>
            الحالة
            <select name="status" defaultValue="published">
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy}>
            <Save /> حفظ الواجب
          </button>
        </form>
      </section>

      <section className="dashboard-panel wide-panel">
        <div className="panel-title">
          <ClipboardCheck />
          <div>
            <h2>الواجبات</h2>
            <p>{assignments.length} واجب</p>
          </div>
        </div>
        <div className="management-list">
          {assignments.map((assignment) => (
            <article key={assignment.id}>
              <div>
                <strong>{assignment.title}</strong>
                <small>
                  {assignment.courseTitle} ·{' '}
                  {assignment.dueAt
                    ? `التسليم ${new Date(assignment.dueAt).toLocaleString('ar-EG')}`
                    : 'بدون موعد تسليم'}
                </small>
                <p>{assignment.description}</p>
              </div>
              <div className="list-actions">
                <span
                  className={`status-pill status-${assignment.status === 'published' ? 'approved' : 'pending'}`}
                >
                  {assignment.status === 'published' ? 'منشور' : 'مسودة'}
                </span>
                <details>
                  <summary className="icon-button" aria-label="تعديل الواجب">
                    <PencilLine />
                  </summary>
                  <form
                    className="stack-form dashboard-popover-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onEdit(assignment.id, formValues(event.currentTarget));
                    }}
                  >
                    <label>
                      الكورس
                      <select name="courseId" defaultValue={assignment.courseId} required>
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      العنوان
                      <input name="title" defaultValue={assignment.title} required />
                    </label>
                    <label>
                      التفاصيل
                      <textarea name="description" rows={4} defaultValue={assignment.description} />
                    </label>
                    <div className="form-row">
                      <label>
                        موعد التسليم
                        <input
                          name="dueAt"
                          type="datetime-local"
                          defaultValue={dateTimeValue(assignment.dueAt)}
                        />
                      </label>
                      <label>
                        الدرجة
                        <input name="maxScore" type="number" defaultValue={assignment.maxScore} />
                      </label>
                    </div>
                    <label>
                      الحالة
                      <select name="status" defaultValue={assignment.status}>
                        <option value="published">منشور</option>
                        <option value="draft">مسودة</option>
                      </select>
                    </label>
                    <button className="btn btn-primary" disabled={busy}>
                      <Save /> حفظ التعديلات
                    </button>
                  </form>
                </details>
                <button
                  className="icon-button danger"
                  aria-label="حذف الواجب"
                  disabled={busy}
                  onClick={() => onDelete(assignment.id)}
                >
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
          {!assignments.length && <div className="empty-state">لا توجد واجبات حتى الآن.</div>}
        </div>
      </section>
    </div>
  );
}
