'use client';

/**
 * app/components/admin/domains/AssignmentsManagerView.tsx
 *
 * Complete Assignments domain management page with:
 * - PDF / MCQ / Generic assignment types
 * - Teacher PDF file upload and removal
 * - MCQ question builder
 * - Student submission viewing and grading
 */

import { useState, useMemo, useRef, useCallback, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ClipboardCheck,
  CirclePlus,
  PencilLine,
  Trash2,
  Calendar,
  Award,
  Save,
  X,
  Upload,
  FileText,
  Users,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Download,
  Plus,
  Loader2,
  BookOpen,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Assignment } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateTimeValue(timestamp?: number | null): string {
  if (!timestamp) return '';
  const offset = new Date(timestamp).getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function typeLabel(type: string) {
  if (type === 'mcq') return 'اختيار من متعدد';
  if (type === 'generic') return 'عام';
  return 'PDF';
}

function typeColor(type: string) {
  if (type === 'mcq') return 'status-published';
  if (type === 'generic') return 'status-draft';
  return 'status-active';
}

// ─── Submission type ──────────────────────────────────────────────────────────

type Submission = {
  id: string;
  studentEmail: string;
  status: string;
  score: number | null;
  maxScore: number | null;
  feedback: string;
  submittedAt: number;
  gradedAt: number | null;
  hasPdf: number;
};

type MCQQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  points: number;
  sortOrder: number;
};

function AssignmentFormFields({
  defaults,
  courses,
}: {
  defaults?: Assignment;
  courses: Array<{ id: string; title: string }>;
}) {
  return (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="assign-course">الكورس *</label>
        <select
          id="assign-course"
          name="courseId"
          className="form-control"
          defaultValue={defaults?.courseId || ''}
          required
        >
          <option value="">-- اختر كورس --</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="assign-title">عنوان الواجب *</label>
        <input
          id="assign-title"
          name="title"
          className="form-control"
          placeholder="مثال: واجب الوحدة الأولى"
          defaultValue={defaults?.title || ''}
          required
          minLength={3}
          maxLength={150}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="assign-desc">وصف الواجب</label>
        <textarea
          id="assign-desc"
          name="description"
          className="form-control"
          rows={3}
          placeholder="اشرح تعليمات الواجب..."
          defaultValue={defaults?.description || ''}
          maxLength={3000}
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="assign-type">نوع الواجب</label>
          <select
            id="assign-type"
            name="type"
            className="form-control"
            defaultValue={defaults?.type || 'pdf'}
          >
            <option value="pdf">PDF (رفع ملف)</option>
            <option value="mcq">اختيار من متعدد (MCQ)</option>
            <option value="generic">عام (بدون تسليم)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="assign-score">الدرجة الكاملة</label>
          <input
            id="assign-score"
            name="maxScore"
            type="number"
            className="form-control"
            min={0}
            max={10000}
            defaultValue={defaults?.maxScore ?? 0}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="assign-due">
            <Calendar size={14} /> موعد التسليم
          </label>
          <input
            id="assign-due"
            name="dueAt"
            type="datetime-local"
            className="form-control"
            defaultValue={dateTimeValue(defaults?.dueAt)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="assign-status">الحالة</label>
          <select
            id="assign-status"
            name="status"
            className="form-control"
            defaultValue={defaults?.status || 'draft'}
          >
            <option value="draft">مسودة</option>
            <option value="published">منشور</option>
          </select>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubmissionsPanel({ assignment }: { assignment: Assignment }) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [gradeScore, setGradeScore] = useState('');
  const [gradeFeedback, setGradeFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await adminApiRequest(`/api/admin/assignments/${assignment.id}/submissions`)) as { submissions: Submission[] };
      setSubmissions(data.submissions || []);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [assignment.id]);

  const handleGrade = async (subId: string) => {
    setBusy(true);
    setMsg('');
    try {
      await adminApiRequest(
        `/api/admin/assignments/${assignment.id}/submissions/${subId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ score: Number(gradeScore), feedback: gradeFeedback }),
        }
      );
      setMsg('تم حفظ الدرجة بنجاح');
      setGradingId(null);
      await loadSubmissions();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'حدث خطأ');
    }
    setBusy(false);
  };

  if (!loaded) {
    return (
      <div className="domain-section" style={{ marginTop: '1rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => void loadSubmissions()}
          disabled={loading}
        >
          {loading ? <Loader2 className="spin" /> : <Users />}
          عرض إجابات الطلاب ({assignment.type === 'mcq' ? 'مصححة تلقائياً' : 'يحتاج تصحيح'})
        </button>
      </div>
    );
  }

  return (
    <div className="domain-section" style={{ marginTop: '1rem' }}>
      <div className="domain-section-header" style={{ marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} /> إجابات الطلاب ({submissions.length})
        </h4>
        <button className="btn btn-ghost btn-sm" onClick={() => void loadSubmissions()}>
          تحديث
        </button>
      </div>
      {msg && <p className="form-feedback" style={{ color: 'var(--admin-success)' }}>{msg}</p>}
      {submissions.length === 0 ? (
        <p className="domain-empty-text">لا توجد إجابات مقدمة بعد.</p>
      ) : (
        <div className="submissions-list">
          {submissions.map((sub) => (
            <div key={sub.id} className="submission-row">
              <div className="submission-meta">
                <span className="submission-email">{sub.studentEmail}</span>
                <span className="submission-time">
                  <Clock3 size={12} />
                  {new Date(sub.submittedAt).toLocaleString('ar-EG')}
                </span>
                {sub.status === 'graded' ? (
                  <span className="status-badge status-published">
                    <CheckCircle2 size={12} /> مصحح: {sub.score}/{sub.maxScore}
                  </span>
                ) : (
                  <span className="status-badge status-draft">بانتظار التصحيح</span>
                )}
              </div>
              <div className="submission-actions">
                {sub.hasPdf === 1 && (
                  <a
                    href={`/api/admin/assignments/${assignment.id}/submissions/${sub.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <Download size={14} /> تحميل PDF
                  </a>
                )}
                {assignment.type !== 'mcq' && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setGradingId(sub.id);
                      setGradeScore(sub.score !== null ? String(sub.score) : '');
                      setGradeFeedback(sub.feedback || '');
                    }}
                  >
                    <Award size={14} /> تصحيح
                  </button>
                )}
              </div>
              {gradingId === sub.id && (
                <div className="grading-form">
                  <div className="form-row">
                    <label className="form-label">الدرجة</label>
                    <input
                      type="number"
                      className="form-control"
                      value={gradeScore}
                      min={0}
                      max={assignment.maxScore || 100}
                      onChange={(e) => setGradeScore(e.target.value)}
                      style={{ width: '120px' }}
                    />
                    <span className="form-hint">/ {assignment.maxScore || '—'}</span>
                  </div>
                  <div className="form-row" style={{ flexDirection: 'column', alignItems: 'start' }}>
                    <label className="form-label">ملاحظات (اختياري)</label>
                    <textarea
                      className="form-control"
                      value={gradeFeedback}
                      onChange={(e) => setGradeFeedback(e.target.value)}
                      rows={2}
                      maxLength={2000}
                    />
                  </div>
                  <div className="form-row">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleGrade(sub.id)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />} حفظ الدرجة
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setGradingId(null)}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MCQQuestionsPanel({ assignment }: { assignment: Assignment }) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [questions, setQuestions] = useState<MCQQuestion[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newOptions, setNewOptions] = useState(['', '', '', '']);
  const [newCorrect, setNewCorrect] = useState(0);
  const [newPoints, setNewPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await adminApiRequest(`/api/admin/assignments/${assignment.id}/questions`)) as { questions: MCQQuestion[] };
      setQuestions(data.questions || []);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [assignment.id]);

  const handleAddQuestion = async () => {
    const validOptions = newOptions.filter((o) => o.trim().length > 0);
    if (newQ.trim().length < 3) { setMsg('أدخل نص السؤال'); return; }
    if (validOptions.length < 2) { setMsg('يجب إدخال خيارَين على الأقل'); return; }
    setBusy(true);
    setMsg('');
    try {
      await adminApiRequest(`/api/admin/assignments/${assignment.id}/questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: newQ,
          options: validOptions,
          correctIndex: newCorrect,
          points: newPoints,
          sortOrder: questions.length,
        }),
      });
      setNewQ('');
      setNewOptions(['', '', '', '']);
      setNewCorrect(0);
      setNewPoints(1);
      setShowAdd(false);
      await loadQuestions();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'خطأ في إضافة السؤال');
    }
    setBusy(false);
  };

  const handleDeleteQuestion = async (qId: string) => {
    setBusy(true);
    await adminApiRequest(`/api/admin/assignments/${assignment.id}/questions/${qId}`, {
      method: 'DELETE',
    });
    await loadQuestions();
    setBusy(false);
  };

  if (!loaded) {
    return (
      <div className="domain-section" style={{ marginTop: '1rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => void loadQuestions()}
          disabled={loading}
        >
          {loading ? <Loader2 className="spin" /> : <BookOpen />}
          إدارة أسئلة الواجب ({questions.length})
        </button>
      </div>
    );
  }

  return (
    <div className="domain-section" style={{ marginTop: '1rem' }}>
      <div className="domain-section-header" style={{ marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0 }}>أسئلة الواجب ({questions.length})</h4>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} /> سؤال جديد
        </button>
      </div>
      {msg && <p style={{ color: 'var(--admin-danger)', fontSize: '0.85rem' }}>{msg}</p>}

      {showAdd && (
        <div className="question-add-form" style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--admin-bg-inset)', borderRadius: '8px', border: '1px solid var(--admin-border)' }}>
          <div className="form-group">
            <label className="form-label">نص السؤال *</label>
            <textarea
              className="form-control"
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              rows={2}
              placeholder="اكتب السؤال هنا..."
            />
          </div>
          <div className="form-group">
            <label className="form-label">الخيارات (ضع علامة على الإجابة الصحيحة)</label>
            {newOptions.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.375rem' }}>
                <input
                  type="radio"
                  name={`correct-${assignment.id}`}
                  checked={newCorrect === i}
                  onChange={() => setNewCorrect(i)}
                  aria-label={`خيار ${i + 1} صحيح`}
                />
                <input
                  className="form-control"
                  style={{ flex: 1 }}
                  placeholder={`الخيار ${i + 1}`}
                  value={opt}
                  onChange={(e) => {
                    const arr = [...newOptions];
                    arr[i] = e.target.value;
                    setNewOptions(arr);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="form-group">
            <label className="form-label">الدرجة لهذا السؤال</label>
            <input
              type="number"
              className="form-control"
              style={{ width: '100px' }}
              value={newPoints}
              min={1}
              max={100}
              onChange={(e) => setNewPoints(Number(e.target.value))}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void handleAddQuestion()}
              disabled={busy}
            >
              {busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />} إضافة
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="questions-list">
        {questions.length === 0 ? (
          <p className="domain-empty-text">لا توجد أسئلة بعد. أضف سؤالاً لبدء الواجب.</p>
        ) : (
          questions.map((q, idx) => (
            <div key={q.id} className="question-item">
              <div className="question-header">
                <span className="question-num">س{idx + 1}</span>
                <span className="question-text">{q.question}</span>
                <span className="question-points">{q.points} درجة</span>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => void handleDeleteQuestion(q.id)}
                  aria-label="حذف السؤال"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="question-options">
                {q.options.map((opt, i) => (
                  <span
                    key={i}
                    className={`question-option ${i === q.correctIndex ? 'correct' : ''}`}
                  >
                    {i === q.correctIndex && <CheckCircle2 size={12} />}
                    {opt}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Teacher File Panel ───────────────────────────────────────────────────────

function TeacherFilePanel({ assignment, onFileChange }: { assignment: Assignment; onFileChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (!file.type.includes('pdf')) {
      setMsg('يجب اختيار ملف PDF فقط');
      return;
    }
    setBusy(true);
    setMsg('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await adminApiRequest(`/api/admin/assignments/${assignment.id}/file`, {
        method: 'POST',
        body: fd,
      });
      setMsg('تم رفع الملف بنجاح');
      onFileChange();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'فشل رفع الملف');
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDelete = async () => {
    if (!confirm('هل تريد حذف ملف الواجب؟')) return;
    setBusy(true);
    try {
      await adminApiRequest(`/api/admin/assignments/${assignment.id}/file`, { method: 'DELETE' });
      setMsg('تم حذف الملف');
      onFileChange();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'فشل حذف الملف');
    }
    setBusy(false);
  };

  return (
    <div className="teacher-file-panel">
      <div className="teacher-file-header">
        <FileText size={16} />
        <span>ملف الواجب للطالب</span>
        {assignment.hasTeacherFile === 1 && (
          <span className="status-badge status-published">مرفوع</span>
        )}
      </div>
      {msg && <p className="form-feedback" style={{ fontSize: '0.8rem' }}>{msg}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
        {assignment.hasTeacherFile === 1 && (
          <>
            <a
              href={`/api/admin/assignments/${assignment.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <Download size={14} /> عرض الملف
            </a>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void handleDelete()} disabled={busy}>
              <Trash2 size={14} /> حذف الملف
            </button>
          </>
        )}
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={14} />
          {assignment.hasTeacherFile === 1 ? 'استبدال الملف' : 'رفع ملف PDF'}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
            onChange={() => void handleUpload()}
          />
        </label>
        {busy && <Loader2 className="spin" size={16} />}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AssignmentsManagerView() {
  const searchParams = useSearchParams();
  const defaultCourseIdFromUrl = searchParams.get('courseId') || '';

  const { data, busy: ctxBusy, mutate, openConfirm, refreshData } = useAdmin();
  const [search, setSearch] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(defaultCourseIdFromUrl);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const courses = useMemo(() => data?.courses || [], [data?.courses]);
  const assignments = useMemo(() => data?.assignments || [], [data?.assignments]);

  const filteredAssignments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((item) => {
      const matchSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.courseTitle && item.courseTitle.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q));
      const matchCourse = !selectedCourseId || item.courseId === selectedCourseId;
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchSearch && matchCourse && matchStatus;
    });
  }, [assignments, search, selectedCourseId, statusFilter]);

  const handleAddAssignment = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const dueAtStr = fd.get('dueAt') as string;

    const ok = await mutate(
      () =>
        adminApiRequest('/api/admin/assignments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId: fd.get('courseId'),
            title: fd.get('title'),
            description: fd.get('description') || '',
            dueAt: dueAtStr ? new Date(dueAtStr).getTime() : null,
            maxScore: Number(fd.get('maxScore')) || 0,
            type: fd.get('type') || 'pdf',
            status: fd.get('status') || 'published',
          }),
        }),
      'تم إنشاء الواجب بنجاح'
    );

    if (ok) {
      form.reset();
      setIsAddOpen(false);
    }
  };

  const handleEditAssignment = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingAssignment) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const dueAtStr = fd.get('dueAt') as string;

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/assignments/${editingAssignment.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId: fd.get('courseId') || editingAssignment.courseId,
            title: fd.get('title'),
            description: fd.get('description') || '',
            dueAt: dueAtStr ? new Date(dueAtStr).getTime() : null,
            maxScore: Number(fd.get('maxScore')) || 0,
            type: fd.get('type') || editingAssignment.type || 'pdf',
            status: fd.get('status'),
          }),
        }),
      'تم تحديث الواجب بنجاح'
    );

    if (ok) {
      setEditingAssignment(null);
    }
  };

  const handleDeleteAssignment = (assignment: Assignment) => {
    openConfirm({
      title: 'حذف الواجب',
      message: `هل تريد حذف الواجب "${assignment.title}"؟ لا يمكن التراجع.`,
      confirmLabel: 'حذف',
      isDestructive: true,
      onConfirm: async () => {
        await mutate(
          () =>
            adminApiRequest(`/api/admin/assignments/${assignment.id}`, { method: 'DELETE' }),
          'تم حذف الواجب'
        );
      },
    });
  };

  const togglePublish = async (assignment: Assignment) => {
    const newStatus = assignment.status === 'published' ? 'draft' : 'published';
    await mutate(
      () =>
        adminApiRequest(`/api/admin/assignments/${assignment.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        }),
      newStatus === 'published' ? 'تم النشر' : 'تم إلغاء النشر'
    );
  };

  return (
    <div className="domain-view">
      <AdminPageHeader
        title="الواجبات"
        description="أنشئ وادر واجبات الكورسات (PDF أو MCQ) وتابع إجابات الطلاب."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => setIsAddOpen(true)}
            id="btn-add-assignment"
          >
            <CirclePlus size={16} /> واجب جديد
          </button>
        }
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالعنوان أو الكورس..."
        resultCount={filteredAssignments.length}
        filters={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              className="admin-select"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              aria-label="تصفية حسب الكورس"
            >
              <option value="">جميع الكورسات</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <select
              className="admin-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="تصفية حسب الحالة"
            >
              <option value="all">جميع الحالات</option>
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
            </select>
          </div>
        }
      />

      {/* ─── Add Modal ─────────────────────────────────────────────────────── */}
      {isAddOpen && (
        <div className="modal-overlay" onClick={() => setIsAddOpen(false)} role="dialog" aria-modal="true" aria-labelledby="add-assign-title">
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="add-assign-title" className="modal-title"><CirclePlus /> إنشاء واجب جديد</h2>
              <button className="modal-close" onClick={() => setIsAddOpen(false)} aria-label="إغلاق"><X /></button>
            </div>
            <form onSubmit={(e) => void handleAddAssignment(e)} className="modal-form">
              <AssignmentFormFields courses={courses} />
              <div className="modal-footer">
                <button className="btn btn-ghost" type="button" onClick={() => setIsAddOpen(false)}>إلغاء</button>
                <button className="btn btn-primary" type="submit" disabled={ctxBusy}>
                  {ctxBusy ? <Loader2 className="spin" /> : <Save />} إنشاء الواجب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit Modal ────────────────────────────────────────────────────── */}
      {editingAssignment && (
        <div className="modal-overlay" onClick={() => setEditingAssignment(null)} role="dialog" aria-modal="true" aria-labelledby="edit-assign-title">
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="edit-assign-title" className="modal-title"><PencilLine /> تعديل الواجب</h2>
              <button className="modal-close" onClick={() => setEditingAssignment(null)} aria-label="إغلاق"><X /></button>
            </div>
            <form onSubmit={(e) => void handleEditAssignment(e)} className="modal-form">
              <AssignmentFormFields courses={courses} defaults={editingAssignment} />
              <div className="modal-footer">
                <button className="btn btn-ghost" type="button" onClick={() => setEditingAssignment(null)}>إلغاء</button>
                <button className="btn btn-primary" type="submit" disabled={ctxBusy}>
                  {ctxBusy ? <Loader2 className="spin" /> : <Save />} حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Assignment List ────────────────────────────────────────────────── */}
      {filteredAssignments.length === 0 ? (
        <AdminEmptyState
          icon={ClipboardCheck}
          title="لا توجد واجبات"
          description="ابدأ بإنشاء واجب جديد للكورس."
          action={
            <button className="btn btn-primary" onClick={() => setIsAddOpen(true)}>
              <CirclePlus /> واجب جديد
            </button>
          }
        />
      ) : (
        <div className="domain-list">
          {filteredAssignments.map((assignment) => (
            <article key={assignment.id} className={`domain-card ${expandedId === assignment.id ? 'expanded' : ''}`}>
              <div className="domain-card-main">
                <div className="domain-card-info">
                  <div className="domain-card-title-row">
                    <h3 className="domain-card-title">{assignment.title}</h3>
                    <AdminStatusBadge status={assignment.status} />
                    <span className={`status-badge ${typeColor(assignment.type || 'pdf')}`}>
                      {typeLabel(assignment.type || 'pdf')}
                    </span>
                  </div>
                  <div className="domain-card-meta">
                    <span>{assignment.courseTitle}</span>
                    {assignment.dueAt && (
                      <span>
                        <Calendar size={12} />
                        التسليم: {new Date(assignment.dueAt).toLocaleDateString('ar-EG')}
                      </span>
                    )}
                    {assignment.maxScore > 0 && (
                      <span>
                        <Award size={12} />
                        {assignment.maxScore} درجة
                      </span>
                    )}
                    {assignment.hasTeacherFile === 1 && (
                      <span style={{ color: 'var(--admin-success)' }}>
                        <FileText size={12} /> ملف مرفوع
                      </span>
                    )}
                  </div>
                  {assignment.description && (
                    <p className="domain-card-description">{assignment.description}</p>
                  )}
                </div>
                <div className="domain-card-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setExpandedId(expandedId === assignment.id ? null : assignment.id)}
                    aria-expanded={expandedId === assignment.id}
                    aria-label="عرض التفاصيل"
                  >
                    {expandedId === assignment.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <button
                    className={`btn btn-sm ${assignment.status === 'published' ? 'btn-ghost' : 'btn-secondary'}`}
                    onClick={() => void togglePublish(assignment)}
                    disabled={ctxBusy}
                  >
                    {assignment.status === 'published' ? 'إلغاء النشر' : 'نشر'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditingAssignment(assignment)}
                    aria-label="تعديل"
                  >
                    <PencilLine size={16} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleDeleteAssignment(assignment)}
                    aria-label="حذف"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* ─── Expanded panel ───────────────────────────────────────── */}
              {expandedId === assignment.id && (
                <div className="domain-card-expanded">
                  {/* Teacher file upload — only for pdf type */}
                  {(assignment.type === 'pdf' || !assignment.type) && (
                    <TeacherFilePanel
                      assignment={assignment}
                      onFileChange={() => void refreshData()}
                    />
                  )}

                  {/* MCQ question builder */}
                  {assignment.type === 'mcq' && (
                    <MCQQuestionsPanel assignment={assignment} />
                  )}

                  {/* Student submissions */}
                  <SubmissionsPanel assignment={assignment} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
