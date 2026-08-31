'use client';

/**
 * app/components/admin/domains/ResultsManagerView.tsx
 *
 * Dedicated Results & Grading domain management page (/admin/results):
 * - Student exam attempt records inspection
 * - Filter by exam and search by student email
 * - Review attempt modal to override score (0..maxScore) and write teacher feedback
 * - Grading method identification (teacher review, automated rules, AI)
 */

import { useState, useMemo } from 'react';
import {
  BarChart3,
  PencilLine,
  Save,
  X,
  CheckCircle2,
  BrainCircuit,
  UserCheck,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Attempt } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';

export function ResultsManagerView() {
  const { data, busy, mutate } = useAdmin();
  const [search, setSearch] = useState('');
  const [examFilter, setExamFilter] = useState('all');
  const [reviewingAttempt, setReviewingAttempt] = useState<Attempt | null>(null);

  const attempts = useMemo(() => data?.attempts || [], [data?.attempts]);
  const exams = useMemo(() => data?.exams || [], [data?.exams]);

  const filteredAttempts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attempts.filter((item) => {
      const matchSearch =
        !q ||
        item.userEmail.toLowerCase().includes(q) ||
        item.examTitle.toLowerCase().includes(q);
      const matchExam = examFilter === 'all' || item.examTitle === examFilter;
      return matchSearch && matchExam;
    });
  }, [attempts, search, examFilter]);

  const handleSaveReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reviewingAttempt) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const scoreVal = Number(fd.get('score'));
    const feedbackVal = String(fd.get('feedback') || '');

    if (scoreVal < 0 || scoreVal > reviewingAttempt.maxScore) {
      alert(`الدرجة يجب أن تكون بين 0 و ${reviewingAttempt.maxScore}`);
      return;
    }

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/attempts/${reviewingAttempt.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            score: scoreVal,
            feedback: feedbackVal,
          }),
        }),
      'تم حفظ وتحديث نتيجة الطالب وملاحظات المدرس بنجاح'
    );

    if (ok) {
      setReviewingAttempt(null);
    }
  };

  const renderGradingBadge = (method: string) => {
    if (method === 'teacher_review') {
      return (
        <span className="admin-grading-method-badge method-teacher">
          <UserCheck size={13} /> مراجعة المدرس
        </span>
      );
    }
    if (method === 'ai') {
      return (
        <span className="admin-grading-method-badge method-ai">
          <BrainCircuit size={13} /> ذكاء اصطناعي
        </span>
      );
    }
    return (
      <span className="admin-grading-method-badge method-rules">
        <CheckCircle2 size={13} /> تصحيح تلقائي
      </span>
    );
  };

  return (
    <div className="admin-results-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="النتائج وتصحيح الامتحانات"
        description="استعراض محاولات الطلاب في الامتحانات، مراجعة الإجابات، وتعديل الدرجات مع إضافة ملاحظات المدرس."
        breadcrumbs={[{ label: 'النتائج والتصحيح' }]}
        badge={
          <span className="admin-header-pill">
            <BarChart3 size={14} /> {attempts.length} محاولة
          </span>
        }
      />

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالبريد الإلكتروني للطالب أو اسم الامتحان..."
        resultCount={filteredAttempts.length}
        onClearFilters={() => {
          setSearch('');
          setExamFilter('all');
        }}
        filters={
          <select
            value={examFilter}
            onChange={(e) => setExamFilter(e.target.value)}
            className="admin-select"
            aria-label="تصفية المحاولات حسب الامتحان"
          >
            <option value="all">كل الامتحانات</option>
            {exams.map((e) => (
              <option key={e.id} value={e.title}>
                {e.title}
              </option>
            ))}
          </select>
        }
      />

      {/* ── Attempts Table ─────────────────────────────────────────────────── */}
      {filteredAttempts.length === 0 ? (
        <AdminEmptyState
          icon={BarChart3}
          title="لا توجد نتائج مطابقة"
          description={
            search || examFilter !== 'all'
              ? 'جرّب تعديل معايير البحث والتصفية لعرض النتائج.'
              : 'لم يقم أي طالب بإجراء الامتحانات حتى الآن.'
          }
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الامتحان</th>
                <th>الدرجة المحققة</th>
                <th>طريقة التصحيح</th>
                <th>تاريخ التسليم</th>
                <th className="text-end">المراجعة</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttempts.map((attempt) => {
                const percentage = Math.round((attempt.score / (attempt.maxScore || 1)) * 100);
                const isPassed = percentage >= 50;

                return (
                  <tr key={attempt.id}>
                    <td>
                      <div className="table-entity-cell">
                        <strong className="entity-primary-text" dir="ltr">
                          {attempt.userEmail}
                        </strong>
                      </div>
                    </td>
                    <td>
                      <span className="admin-course-cell-title">{attempt.examTitle}</span>
                    </td>
                    <td>
                      <div className="table-score-cell">
                        <strong className={`score-val ${isPassed ? 'text-success' : 'text-danger'}`}>
                          {attempt.score} / {attempt.maxScore}
                        </strong>
                        <small className="score-pct">({percentage}%)</small>
                      </div>
                    </td>
                    <td>{renderGradingBadge(attempt.gradingMethod)}</td>
                    <td>
                      <span className="table-date-text">
                        {attempt.submittedAt
                          ? new Date(attempt.submittedAt).toLocaleDateString('ar-EG')
                          : '—'}
                      </span>
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setReviewingAttempt(attempt)}
                        title="مراجعة وتعديل الدرجة"
                      >
                        <PencilLine size={14} /> مراجعة الدرجة
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Review Score Modal ──────────────────────────────────────────────── */}
      {reviewingAttempt && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewingAttempt(null);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="review-modal-title" className="admin-modal-title">
                مراجعة نتيجة الطالب
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setReviewingAttempt(null)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleSaveReview}>
              <div className="admin-attempt-summary-box">
                <div>
                  <span className="info-label">الطالب:</span>
                  <strong dir="ltr">{reviewingAttempt.userEmail}</strong>
                </div>
                <div>
                  <span className="info-label">الامتحان:</span>
                  <strong>{reviewingAttempt.examTitle}</strong>
                </div>
                <div>
                  <span className="info-label">الدرجة العظمى:</span>
                  <strong>{reviewingAttempt.maxScore} درجة</strong>
                </div>
              </div>

              <label className="admin-field-label">
                <span>
                  الدرجة المعدلة (من {reviewingAttempt.maxScore}) <span className="text-danger">*</span>
                </span>
                <input
                  name="score"
                  type="number"
                  min="0"
                  max={reviewingAttempt.maxScore}
                  defaultValue={reviewingAttempt.score}
                  required
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>ملاحظات وتغذية راجعة من المدرس (تظهر للطالب)</span>
                <textarea
                  name="feedback"
                  rows={4}
                  maxLength={2000}
                  placeholder="أضف توجيهات للطالب لتحسين مستواه أو تفسير الدرجة..."
                  className="admin-input"
                />
              </label>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setReviewingAttempt(null)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> حفظ نتيجة المراجعة
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
