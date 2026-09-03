'use client';

/**
 * app/components/admin/domains/ExamsManagerView.tsx
 *
 * Dedicated Exams domain management page (/admin/exams):
 * - Create MCQ exam with dynamic question builder & validation
 * - Saved exams catalog with course filter, status toggle, and search
 * - Edit exam metadata & schedule modal
 * - Delete exam with relational dependency guard
 */

import { useState, useMemo, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FileQuestion,
  CirclePlus,
  PencilLine,
  Trash2,
  ClipboardCheck,
  Save,
  X,
  Clock,
  Award,
  ImagePlus,
} from 'lucide-react';
import {
  useAdmin,
  adminApiRequest,
  type Exam,
  type QuestionDraft,
} from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';

const emptyQuestion = (): QuestionDraft => ({
  type: 'multiple_choice',
  prompt: '',
  options: '',
  correctAnswer: '',
  rubric: '',
  explanation: '',
  points: 1,
  imageFile: null,
});

export function ExamsManagerView() {
  const searchParams = useSearchParams();
  const defaultCourseIdFromUrl = searchParams.get('courseId') || '';

  const { data, busy, mutate, openConfirm, openPrompt, refreshData, setNotice, setError } = useAdmin();
  const [search, setSearch] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(defaultCourseIdFromUrl);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);

  const courses = useMemo(() => data?.courses || [], [data?.courses]);
  const exams = useMemo(() => data?.exams || [], [data?.exams]);

  const filteredExams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exams.filter((exam) => {
      const matchSearch =
        !q ||
        exam.title.toLowerCase().includes(q) ||
        (exam.courseTitle && exam.courseTitle.toLowerCase().includes(q)) ||
        (exam.description && exam.description.toLowerCase().includes(q));
      const matchCourse = !selectedCourseId || exam.courseId === selectedCourseId;
      const matchStatus = statusFilter === 'all' || exam.status === statusFilter;
      return matchSearch && matchCourse && matchStatus;
    });
  }, [exams, search, selectedCourseId, statusFilter]);

  const updateQuestion = (index: number, patch: Partial<QuestionDraft>) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, ...patch } : q))
    );
  };

  const handleCreateExam = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const parsedOptions = q.options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
      if (!q.prompt.trim()) {
        alert(`يرجى كتابة نص السؤال رقم ${i + 1}`);
        return;
      }
      if (parsedOptions.length < 2) {
        alert(`السؤال رقم ${i + 1} يحتاج إلى خيارين على الأقل.`);
        return;
      }
      if (!q.correctAnswer || !parsedOptions.includes(q.correctAnswer)) {
        alert(`يرجى تحديد الإجابة الصحيحة للسؤال رقم ${i + 1} من بين الخيارات المكتوبة.`);
        return;
      }
    }

    const preparedQuestions = questions.map((q) => ({
      ...q,
      type: 'multiple_choice',
      options: q.options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean),
    }));

    try {
      const result = await adminApiRequest('/api/admin/exams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          durationMinutes: Number(values.durationMinutes) || 30,
          passingScore: Number(values.passingScore) || 50,
          maxAttempts: Number(values.maxAttempts) || 3,
          assessmentType: values.assessmentType || 'exam',
          mode: values.mode || 'online',
          questions: preparedQuestions,
        }),
      });

      const questionIds = (result as { questionIds?: string[] }).questionIds;
      if (questionIds) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          if (q.imageFile && questionIds[i]) {
            const formData = new FormData();
            formData.append('file', q.imageFile);
            await adminApiRequest(`/api/admin/questions/${questionIds[i]}/image`, {
              method: 'POST',
              body: formData,
            }).catch(() => {});
          }
        }
      }

      setNotice('تم إنشاء الامتحان والأسئلة بنجاح');
      await refreshData(1);
      form.reset();
      setQuestions([emptyQuestion()]);
      setIsBuilderOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية');
    }
  };

  const handleTogglePublish = async (exam: Exam) => {
    const nextStatus = exam.status === 'published' ? 'draft' : 'published';
    await mutate(
      () =>
        adminApiRequest(`/api/admin/exams/${exam.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...exam, status: nextStatus }),
        }),
      nextStatus === 'published' ? 'تم نشر الامتحان للطلاب' : 'تم تحويل الامتحان لمسودة'
    );
  };

  const handleEditMetadata = (exam: Exam) => {
    openPrompt({
      title: `تعديل بيانات «${exam.title}»`,
      fields: [
        { name: 'title', label: 'اسم الامتحان', defaultValue: exam.title },
        {
          name: 'description',
          label: 'الوصف',
          defaultValue: exam.description || '',
          required: false,
        },
        {
          name: 'instructions',
          label: 'تعليمات الطالب',
          defaultValue: exam.instructions || '',
          required: false,
        },
        {
          name: 'durationMinutes',
          label: 'المدة بالدقائق',
          defaultValue: String(exam.durationMinutes),
          type: 'number',
        },
        {
          name: 'passingScore',
          label: 'درجة النجاح (%)',
          defaultValue: String(exam.passingScore),
          type: 'number',
        },
        {
          name: 'maxAttempts',
          label: 'عدد المحاولات المسموحة',
          defaultValue: String(exam.maxAttempts),
          type: 'number',
        },
      ],
      onSubmit: async (values) => {
        await mutate(
          () =>
            adminApiRequest(`/api/admin/exams/${exam.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...exam,
                ...values,
                durationMinutes: Number(values.durationMinutes) || exam.durationMinutes,
                passingScore: Number(values.passingScore) || exam.passingScore,
                maxAttempts: Number(values.maxAttempts) || exam.maxAttempts,
              }),
            }),
          'تم تحديث بيانات الامتحان'
        );
      },
    });
  };

  const handleDeleteExam = (exam: Exam) => {
    openConfirm({
      title: `حذف امتحان «${exam.title}» نهائياً`,
      message:
        'سيتم حذف الامتحان وجميع محاولات الطلاب ونتائجهم وإجاباتهم المرتبطة بهذا الامتحان نهائياً. لا يمكن التراجع عن هذا الإجراء.',
      confirmLabel: 'حذف الامتحان نهائياً',
      requireMatch: 'DELETE',
      isDestructive: true,
      onConfirm: async () => {
        await mutate(
          () => adminApiRequest(`/api/admin/exams/${exam.id}`, { method: 'DELETE' }),
          'تم حذف الامتحان وبياناته التابعة بنجاح'
        );
      },
    });
  };

  return (
    <div className="admin-exams-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="الامتحانات والاختبارات"
        description="إنشاء امتحانات الاختيار من متعدد، ضبط درجات النجاح، ومراجعة الأسئلة المصححة تلقائيًا."
        breadcrumbs={[{ label: 'الامتحانات' }]}
        badge={
          <span className="admin-header-pill">
            <FileQuestion size={14} /> {exams.length} امتحان
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsBuilderOpen(true)}
          >
            <CirclePlus size={16} /> إنشاء امتحان جديد
          </button>
        }
      />

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم الامتحان أو الكورس..."
        resultCount={filteredExams.length}
        onClearFilters={() => {
          setSearch('');
          setSelectedCourseId('');
          setStatusFilter('all');
        }}
        filters={
          <>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="admin-select"
              aria-label="تصفية الامتحانات حسب الكورس"
            >
              <option value="">كل الكورسات</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.grade})
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="admin-select"
              aria-label="تصفية الامتحانات حسب الحالة"
            >
              <option value="all">كل الحالات</option>
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
            </select>
          </>
        }
      />

      {/* ── Exams Catalog Grid ──────────────────────────────────────────────── */}
      {filteredExams.length === 0 ? (
        <AdminEmptyState
          icon={FileQuestion}
          title="لا توجد امتحانات مطابقة"
          description={
            search || selectedCourseId || statusFilter !== 'all'
              ? 'جرّب تعديل معايير البحث والتصفية لعرض النتائج.'
              : 'لم تقم بإنشاء أي امتحان بعد. انقر على الزر أدناه لبناء أول امتحان.'
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsBuilderOpen(true)}
            >
              <CirclePlus size={16} /> إنشاء امتحان
            </button>
          }
        />
      ) : (
        <div className="admin-exams-grid">
          {filteredExams.map((exam) => (
            <article key={exam.id} className="admin-exam-card">
              <div className="admin-exam-card-top">
                <span className="admin-exam-course-tag">
                  {exam.courseTitle || 'امتحان عام'}
                </span>
                <AdminStatusBadge status={exam.status} />
              </div>

              <div className="admin-exam-card-body">
                <h3 className="admin-exam-title">{exam.title}</h3>
                {exam.description && (
                  <p className="admin-exam-description">{exam.description}</p>
                )}

                <div className="admin-exam-meta-grid">
                  <div className="admin-exam-meta-item">
                    <ClipboardCheck size={14} />
                    <span>{exam.questionCount} أسئلة</span>
                  </div>
                  <div className="admin-exam-meta-item">
                    <Award size={14} />
                    <span>{exam.maxScore} درجة (نجاح {exam.passingScore}%)</span>
                  </div>
                  <div className="admin-exam-meta-item">
                    <Clock size={14} />
                    <span>{exam.durationMinutes} دقيقة</span>
                  </div>
                </div>
              </div>

              <div className="admin-exam-card-footer">
                <div className="admin-exam-actions-group">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => handleEditMetadata(exam)}
                  >
                    <PencilLine size={14} /> تعديل البيانات
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleTogglePublish(exam)}
                  >
                    {exam.status === 'published' ? 'إلغاء النشر' : 'نشر'}
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon text-danger"
                  onClick={() => handleDeleteExam(exam)}
                  title="حذف الامتحان"
                  aria-label={`حذف امتحان ${exam.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Exam Creation Builder Modal / Sheet ──────────────────────────────── */}
      {isBuilderOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exam-builder-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsBuilderOpen(false);
          }}
        >
          <div className="admin-modal-card wide-modal">
            <header className="admin-modal-header">
              <h3 id="exam-builder-title" className="admin-modal-title">
                إنشاء امتحان اختيار من متعدد جديد
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setIsBuilderOpen(false)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleCreateExam}>
              <div className="admin-form-section">
                <h4 className="admin-form-section-title">1. البيانات الأساسية للامتحان</h4>

                <div className="admin-form-row">
                  <label className="admin-field-label">
                    <span>اسم الامتحان <span className="text-danger">*</span></span>
                    <input
                      name="title"
                      required
                      placeholder="مثال: امتحان شامل على Unit 1 & Unit 2"
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field-label">
                    <span>الكورس التابع له</span>
                    <select
                      name="courseId"
                      defaultValue={selectedCourseId || ''}
                      className="admin-select"
                    >
                      <option value="">امتحان عام (متاح للجميع)</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} — {c.grade}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="admin-form-row three">
                  <label className="admin-field-label">
                    <span>المدة بالدقائق <span className="text-danger">*</span></span>
                    <input
                      name="durationMinutes"
                      type="number"
                      min="1"
                      max="300"
                      defaultValue="30"
                      required
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field-label">
                    <span>نسبة النجاح (%) <span className="text-danger">*</span></span>
                    <input
                      name="passingScore"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue="50"
                      required
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field-label">
                    <span>عدد المحاولات <span className="text-danger">*</span></span>
                    <input
                      name="maxAttempts"
                      type="number"
                      min="1"
                      max="10"
                      defaultValue="3"
                      required
                      className="admin-input"
                    />
                  </label>
                </div>

                <div className="admin-form-row">
                  <label className="admin-field-label">
                    <span>الوصف</span>
                    <textarea
                      name="description"
                      rows={2}
                      placeholder="ملاحظات توضيحية عن الامتحان..."
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field-label">
                    <span>تعليمات الطالب</span>
                    <textarea
                      name="instructions"
                      rows={2}
                      placeholder="تعليمات تظهر للطالب قبل بدء الامتحان..."
                      className="admin-input"
                    />
                  </label>
                </div>

                <label className="admin-field-label">
                  <span>حالة النشر</span>
                  <select name="status" defaultValue="published" className="admin-select">
                    <option value="published">منشور فورًا</option>
                    <option value="draft">مسودة</option>
                  </select>
                </label>

                <div className="admin-form-row">
                  <label className="admin-field-label">
                    <span>نوع التقييم</span>
                    <select name="assessmentType" defaultValue="exam" className="admin-select">
                      <option value="exam">امتحان</option>
                      <option value="quiz">اختبار سريع (Quiz)</option>
                    </select>
                  </label>

                  <label className="admin-field-label">
                    <span>طريقة التسليم</span>
                    <select name="mode" defaultValue="online" className="admin-select">
                      <option value="online">إلكتروني فقط</option>
                      <option value="file">ملف PDF + إلكتروني</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* Question Builder */}
              <div className="admin-form-section">
                <div className="admin-section-header-row">
                  <h4 className="admin-form-section-title">
                    2. أسئلة الامتحان ({questions.length})
                  </h4>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setQuestions([...questions, emptyQuestion()])}
                  >
                    <CirclePlus size={15} /> إضافة سؤال
                  </button>
                </div>

                <div className="admin-question-list">
                  {questions.map((q, idx) => {
                    const optionsList = q.options
                      .split('\n')
                      .map((o) => o.trim())
                      .filter(Boolean);

                    return (
                      <article key={idx} className="admin-question-editor-card">
                        <header className="admin-question-header">
                          <strong className="admin-question-num">السؤال {idx + 1}</strong>
                          <div className="admin-question-type-tag">
                            <ClipboardCheck size={14} /> اختيار من متعدد
                          </div>
                          {questions.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-danger btn-icon"
                              onClick={() =>
                                setQuestions(questions.filter((_, i) => i !== idx))
                              }
                              title="حذف هذا السؤال"
                              aria-label={`حذف السؤال رقم ${idx + 1}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </header>

                        <div className="admin-question-body">
                          <label className="admin-field-label">
                            <span>نص السؤال <span className="text-danger">*</span></span>
                            <textarea
                              value={q.prompt}
                              onChange={(e) => updateQuestion(idx, { prompt: e.target.value })}
                              required
                              rows={2}
                              placeholder="اكتب نص السؤال هنا..."
                              className="admin-input"
                            />
                          </label>

                          <div className="admin-form-row">
                            <label className="admin-field-label">
                              <span>الدرجة المستحقة <span className="text-danger">*</span></span>
                              <input
                                type="number"
                                min="1"
                                max="100"
                                value={q.points}
                                onChange={(e) =>
                                  updateQuestion(idx, { points: Number(e.target.value) || 1 })
                                }
                                required
                                className="admin-input"
                              />
                            </label>

                            <label className="admin-field-label">
                              <span>الإجابة الصحيحة <span className="text-danger">*</span></span>
                              <select
                                value={q.correctAnswer}
                                onChange={(e) =>
                                  updateQuestion(idx, { correctAnswer: e.target.value })
                                }
                                required
                                className="admin-select"
                              >
                                <option value="">اختر الإجابة الصحيحة</option>
                                {optionsList.map((opt, optIdx) => (
                                  <option key={`${opt}-${optIdx}`} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label className="admin-field-label">
                            <span>الاختيارات (كل اختيار في سطر منفصل) <span className="text-danger">*</span></span>
                            <textarea
                              value={q.options}
                              onChange={(e) => updateQuestion(idx, { options: e.target.value })}
                              required
                              rows={4}
                              placeholder={'الخيار الأول\nالخيار الثاني\nالخيار الثالث\nالخيار الرابع'}
                              className="admin-input"
                            />
                            <small className="admin-field-hint">
                              اكتب اختيارين على الأقل في أسطر منفصلة، ثم اختر الإجابة الصحيحة من القائمة أعلاه.
                            </small>
                          </label>

                          <label className="admin-field-label">
                            <span>تعليق المعلم على الإجابة</span>
                            <textarea
                              value={q.explanation}
                              onChange={(e) => updateQuestion(idx, { explanation: e.target.value })}
                              rows={2}
                              placeholder="شرح يظهر للطالب بعد التسليم (اختياري)..."
                              className="admin-input"
                            />
                            <small className="admin-field-hint">
                              يظهر هذا التعليق للطالب بعد تسليم الامتحان لتوضيح الإجابة الصحيحة.
                            </small>
                          </label>

                          <div className="admin-field-label">
                            <span>صورة السؤال</span>
                            <div className="admin-question-image-row">
                              <label className="btn btn-outline btn-sm">
                                <ImagePlus size={14} /> {q.imageFile ? 'تغيير الصورة' : 'إضافة صورة'}
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="sr-only"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    updateQuestion(idx, { imageFile: file });
                                  }}
                                />
                              </label>
                              {q.imageFile && (
                                <span className="admin-field-hint">{q.imageFile.name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn btn-outline btn-block mt-3"
                  onClick={() => setQuestions([...questions, emptyQuestion()])}
                >
                  <CirclePlus size={16} /> إضافة سؤال آخر
                </button>
              </div>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsBuilderOpen(false)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> حفظ ونشر الامتحان
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
