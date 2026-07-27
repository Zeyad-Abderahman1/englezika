'use client';

/**
 * app/components/AdminDashboard.tsx
 *
 * Layout orchestrator for the admin panel.
 * All heavy sub-sections have been extracted to focused components under
 * app/components/admin/. This file handles: sidebar navigation (with
 * mobile hamburger drawer), topbar, global toasts, tab routing, and the
 * shared prompt modal.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Check,
  CirclePlus,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  PencilLine,
  PlaySquare,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { AdminStatsPanel } from './admin/AdminStatsPanel';
import { AdminCourseList } from './admin/AdminCourseList';
import { AdminAnnouncementsList } from './admin/AdminAnnouncementsList';

// ─── Types ────────────────────────────────────────────────────────────────────

type Course = {
  id: string;
  title: string;
  grade: string;
  description: string;
  price: number;
  status: string;
};
type Exam = {
  id: string;
  courseId?: string;
  title: string;
  description?: string;
  instructions?: string;
  courseTitle?: string;
  durationMinutes: number;
  passingScore: number;
  maxAttempts: number;
  status: string;
  questionCount: number;
  maxScore: number;
};
type Enrollment = {
  id: string;
  userEmail: string;
  courseId: string;
  courseTitle: string;
  status: string;
  paymentMethod?: string;
  paymentReference?: string;
  createdAt: number;
};
type Attempt = {
  id: string;
  userEmail: string;
  examTitle: string;
  score: number;
  maxScore: number;
  gradingMethod: string;
  submittedAt: number;
};
type Video = {
  id: string;
  courseId: string;
  title: string;
  courseTitle: string;
  status: string;
  durationSeconds: number;
  prerequisiteExamId?: string;
  prerequisiteExamTitle?: string;
  minimumScore: number;
  sourceType: string;
  sourceUrl?: string;
  youtubeId?: string;
};
type Contact = {
  id: string;
  name: string;
  phone: string;
  message: string;
  status: string;
  createdAt: number;
};
type Student = {
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  phone: string;
  fatherPhone: string;
  motherPhone: string;
  schoolName: string;
  governorate: string;
  gender: string;
  grade: string;
  section: string;
  createdAt: number;
  activeEnrollments: number;
  totalAttempts: number;
};
type Announcement = { id: string; title: string; body: string; createdAt: number };
type Permission =
  | 'manage_courses'
  | 'manage_exams'
  | 'manage_videos'
  | 'manage_enrollments'
  | 'grade_exams'
  | 'manage_announcements'
  | 'manage_messages'
  | 'view_students'
  | 'manage_staff';
type StaffAccount = {
  email: string;
  name: string;
  role: string;
  permissions: string;
  active: number;
  lockedUntil?: number;
};
type AdminData = {
  admin: { email: string; name: string; role: string; permissions: Permission[] };
  counts: {
    students: number;
    activeEnrollments: number;
    pendingEnrollments: number;
    publishedExams: number;
    attempts: number;
    averageScore: number;
  };
  courses: Course[];
  exams: Exam[];
  enrollments: Enrollment[];
  attempts: Attempt[];
  videos: Video[];
  contacts: Contact[];
  announcements: Announcement[];
};
type Tab =
  | 'overview'
  | 'courses'
  | 'exams'
  | 'videos'
  | 'students'
  | 'enrollments'
  | 'results'
  | 'messages'
  | 'staff';
type QuestionDraft = {
  type: string;
  prompt: string;
  options: string;
  correctAnswer: string;
  rubric: string;
  points: number;
};

const emptyQuestion = (): QuestionDraft => ({
  type: 'multiple_choice',
  prompt: '',
  options: '',
  correctAnswer: '',
  rubric: '',
  points: 1,
});

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
}> = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { id: 'courses', label: 'الكورسات', icon: BookOpen, permission: 'manage_courses' },
  { id: 'exams', label: 'الامتحانات', icon: FileQuestion, permission: 'manage_exams' },
  { id: 'videos', label: 'المحاضرات', icon: PlaySquare, permission: 'manage_videos' },
  { id: 'students', label: 'الطلاب', icon: GraduationCap, permission: 'view_students' },
  { id: 'enrollments', label: 'الاشتراكات', icon: Users, permission: 'manage_enrollments' },
  { id: 'results', label: 'النتائج والتصحيح', icon: BarChart3, permission: 'grade_exams' },
  { id: 'messages', label: 'الرسائل', icon: Mail, permission: 'manage_messages' },
  { id: 'staff', label: 'حسابات الفريق', icon: UserCog, permission: 'manage_staff' },
];

// ─── API helper ───────────────────────────────────────────────────────────────

async function apiRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };
  if (response.status === 401 && path.startsWith('/api/admin/')) {
    window.location.assign('/staff/login');
  }
  if (!response.ok) throw new Error(result.error || 'تعذر تنفيذ العملية');
  return result;
}

// ─── Prompt modal type ────────────────────────────────────────────────────────

type PromptState = {
  isOpen: boolean;
  title: string;
  fields: { name: string; label: string; defaultValue?: string; type?: string }[];
  onSubmit: (values: Record<string, string>) => void;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [uploadProgressPct, setUploadProgressPct] = useState<number | null>(null);
  const [uploadDone, setUploadDone] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [promptModal, setPromptModal] = useState<PromptState>({
    isOpen: false,
    title: '',
    fields: [],
    onSubmit: () => {},
  });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(
        (await apiRequest('/api/admin/bootstrap', { cache: 'no-store' })) as unknown as AdminData
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل لوحة الإدارة');
    }
  }, []);

  useEffect(() => {
    // Initial remote dashboard synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'تعذر تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () =>
    setPromptModal({ isOpen: false, title: '', fields: [], onSubmit: () => {} });

  const openPrompt = (state: Omit<PromptState, 'isOpen'>) =>
    setPromptModal({ isOpen: true, ...state });

  // ── Navigate tab and close mobile sidebar ────────────────────────────────────
  const goTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  if (!data && !error)
    return (
      <div className="dashboard-state">
        <LoaderCircle className="spin" /> جاري تحميل لوحة الإدارة...
      </div>
    );
  if (!data) return <div className="dashboard-state error-toast">{error}</div>;

  const can = (permission: Permission) => data.admin.permissions.includes(permission);
  const availableTabs = tabs.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="admin-layout">
      {/* ── Mobile overlay ──────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={`admin-sidebar${sidebarOpen ? ' admin-sidebar--open' : ''}`}>
        <div className="admin-brand">
          <ShieldCheck />
          <div>
            <strong>{data.admin.name}</strong>
            <small>
              {data.admin.role === 'teacher' ? 'مدرس — صلاحية كاملة' : 'مساعد'} · {data.admin.email}
            </small>
          </div>
        </div>
        <nav>
          {availableTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => goTab(id)} className={tab === id ? 'active' : ''}>
              <Icon /> {label}
              {id === 'students' && data.counts.pendingEnrollments > 0 && (
                <b>{data.counts.pendingEnrollments}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span>بوابة الفريق الخاصة</span>
          <button
            onClick={async () => {
              await fetch('/api/staff/logout', { method: 'POST' });
              window.location.assign('/staff/login');
            }}
          >
            <LogOut /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div className="admin-main">
        <header className="admin-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Mobile hamburger */}
            <button
              className="admin-hamburger btn btn-ghost"
              aria-label="القائمة"
              onClick={() => setSidebarOpen((s) => !s)}
            >
              <Menu />
            </button>
            <div>
              <span className="section-label">لوحة الفريق الخاصة</span>
              <h1>{availableTabs.find((item) => item.id === tab)?.label || 'نظرة عامة'}</h1>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => void load()}>
            <RefreshCw /> تحديث
          </button>
        </header>

        {notice && (
          <div className="success-toast">
            <Check /> {notice}
          </div>
        )}
        {error && (
          <div className="error-toast">
            <X /> {error}
          </div>
        )}

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <>
            <section className="teacher-welcome-hero">
              <div>
                <span>لوحة المدرس</span>
                <h2>أهلًا، {data.admin.name}</h2>
                <p>أنشئ الكورسات، ارفع المحاضرات، وابنِ الامتحانات من مكان واحد.</p>
              </div>
              <div className="teacher-quick-actions">
                {can('manage_courses') && (
                  <button onClick={() => goTab('courses')}>
                    <CirclePlus /> إضافة كورس
                  </button>
                )}
                {can('manage_videos') && (
                  <button onClick={() => goTab('videos')}>
                    <Upload /> رفع محاضرة
                  </button>
                )}
                {can('manage_exams') && (
                  <button onClick={() => goTab('exams')}>
                    <FileQuestion /> إنشاء امتحان
                  </button>
                )}
              </div>
            </section>
            <AdminStatsPanel
              counts={data.counts}
              contacts={data.contacts}
              busy={busy}
              can={can}
              onTabChange={(t) => setTab(t as Tab)}
              onAnnounce={(values, reset) => {
                void mutate(
                  () =>
                    apiRequest('/api/admin/announcements', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(values),
                    }),
                  'تم نشر الإعلان'
                ).then(reset);
              }}
            />
            {can('manage_announcements') &&
              (data as AdminData & { announcements?: Announcement[] }).announcements && (
                <AdminAnnouncementsList
                  announcements={
                    (data as AdminData & { announcements?: Announcement[] }).announcements ?? []
                  }
                  busy={busy}
                  onDelete={(id) =>
                    void mutate(
                      () => apiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
                      'تم حذف الإعلان'
                    )
                  }
                />
              )}
          </>
        )}

        {/* ══ COURSES ═══════════════════════════════════════════════════════ */}
        {tab === 'courses' && (
          <AdminCourseList
            courses={data.courses}
            busy={busy}
            onAddCourse={(values, reset) => {
              void mutate(
                () =>
                  apiRequest('/api/admin/courses', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(values),
                  }),
                'تمت إضافة الكورس'
              ).then(reset);
            }}
            onDeleteCourse={(id) =>
              void mutate(
                () => apiRequest(`/api/admin/courses/${id}`, { method: 'DELETE' }),
                'تم حذف الكورس'
              )
            }
          />
        )}

        {/* ══ EXAMS ═════════════════════════════════════════════════════════ */}
        {tab === 'exams' && (
          <div className="exam-admin-grid">
            <ExamBuilder
              courses={data.courses}
              questions={questions}
              setQuestions={setQuestions}
              busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = Object.fromEntries(new FormData(form));
                const prepared = questions.map((q) => ({
                  ...q,
                  type: 'multiple_choice',
                  options: q.options
                    .split('\n')
                    .map((o) => o.trim())
                    .filter(Boolean),
                }));
                void mutate(
                  () =>
                    apiRequest('/api/admin/exams', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ ...values, questions: prepared }),
                    }),
                  'تم حفظ الامتحان'
                ).then(() => {
                  form.reset();
                  setQuestions([emptyQuestion()]);
                });
              }}
            />
            <section className="dashboard-panel">
              <div className="panel-title">
                <FileQuestion />
                <div>
                  <h2>الامتحانات المحفوظة</h2>
                  <p>{data.exams.length} امتحان</p>
                </div>
              </div>
              <div className="management-list compact">
                {data.exams.map((exam) => (
                  <article key={exam.id}>
                    <div>
                      <strong>{exam.title}</strong>
                      <small>
                        {exam.courseTitle || 'امتحان عام'} · {exam.questionCount} سؤال ·{' '}
                        {exam.maxScore} درجة
                      </small>
                    </div>
                    <div className="list-actions">
                      <button
                        className="status-button"
                        onClick={() =>
                          void mutate(
                            () =>
                              apiRequest(`/api/admin/exams/${exam.id}`, {
                                method: 'PATCH',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({
                                  ...exam,
                                  status: exam.status === 'published' ? 'draft' : 'published',
                                }),
                              }),
                            'تم تحديث حالة الامتحان'
                          )
                        }
                      >
                        {exam.status === 'published' ? 'إلغاء النشر' : 'نشر'}
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() =>
                          void mutate(
                            () => apiRequest(`/api/admin/exams/${exam.id}`, { method: 'DELETE' }),
                            'تم حذف الامتحان'
                          )
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ══ VIDEOS ════════════════════════════════════════════════════════ */}
        {tab === 'videos' && (
          <div className="admin-split">
            <section className="dashboard-panel">
              <div className="panel-title">
                <Upload />
                <div>
                  <h2>رفع فيديو آمن</h2>
                  <p>الفيديو يُحفظ في مساحة خاصة ولا يظهر إلا للمشتركين</p>
                </div>
              </div>
              <VideoUploader
                courses={data.courses}
                videos={data.videos}
                busy={busy}
                progressPct={uploadProgressPct}
                uploadDone={uploadDone}
                xhrRef={xhrRef}
                onProgressPct={setUploadProgressPct}
                onUploadDone={setUploadDone}
                onDone={async () => {
                  setNotice('تم رفع المحاضرة وتأمينها');
                  await load();
                }}
                onError={setError}
              />
            </section>
            <section className="dashboard-panel wide-panel">
              <div className="panel-title">
                <PlaySquare />
                <div>
                  <h2>مكتبة الفيديو</h2>
                  <p>{data.videos.length} فيديو محمي</p>
                </div>
              </div>
              <div className="management-list compact">
                {data.videos.map((video) => (
                  <article key={video.id}>
                    <div>
                      <strong>{video.title}</strong>
                      <small>
                        {video.courseTitle} ·{' '}
                        {video.sourceType === 'youtube' ? 'YouTube غير مدرج' : 'ملف خاص'} · يفتح بعد
                        إكمال المحاضرة السابقة
                      </small>
                    </div>
                    <div className="list-actions">
                      <button
                        className="status-button"
                        onClick={() => {
                          openPrompt({
                            title: 'تعديل عنوان الفيديو',
                            fields: [
                              {
                                name: 'title',
                                label: 'عنوان الفيديو الجديد',
                                defaultValue: video.title,
                              },
                            ],
                            onSubmit: (v) => {
                              if (!v.title || v.title.trim().length < 2) return;
                              void mutate(
                                () =>
                                  apiRequest(`/api/admin/videos/${video.id}`, {
                                    method: 'PATCH',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({
                                      title: v.title.trim(),
                                      status: video.status,
                                    }),
                                  }),
                                'تم تعديل عنوان الفيديو'
                              );
                            },
                          });
                        }}
                      >
                        <PencilLine /> تعديل
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() =>
                          void mutate(
                            () => apiRequest(`/api/admin/videos/${video.id}`, { method: 'DELETE' }),
                            'تم حذف الفيديو'
                          )
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ══ STUDENTS ══════════════════════════════════════════════════════ */}
        {tab === 'students' && can('view_students') && <StudentsPanel />}

        {/* ══ ENROLLMENTS ═══════════════════════════════════════════════════ */}
        {tab === 'enrollments' && (
          <section className="dashboard-panel">
            <div className="panel-title">
              <Users />
              <div>
                <h2>طلبات الاشتراك</h2>
                <p>راجع الرقم المرجعي ثم فعّل أو ارفض الطلب</p>
              </div>
            </div>
            <div className="results-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الطالب</th>
                    <th>الكورس</th>
                    <th>الدفع</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {data.enrollments.map((item) => (
                    <tr key={item.id}>
                      <td>{item.userEmail}</td>
                      <td>{item.courseTitle}</td>
                      <td>
                        {item.paymentMethod || '—'}
                        <small className="table-note">
                          {item.paymentReference || 'بدون رقم مرجعي'}
                        </small>
                      </td>
                      <td>
                        <span className={`status-pill status-${item.status}`}>
                          {item.status === 'approved'
                            ? 'مفعّل'
                            : item.status === 'pending'
                              ? 'معلّق'
                              : 'مرفوض'}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            onClick={() =>
                              void mutate(
                                () =>
                                  apiRequest(`/api/admin/enrollments/${item.id}`, {
                                    method: 'PATCH',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ status: 'approved' }),
                                  }),
                                'تم تفعيل الاشتراك'
                              )
                            }
                          >
                            <Check /> تفعيل
                          </button>
                          <button
                            className="danger-text"
                            onClick={() =>
                              void mutate(
                                () =>
                                  apiRequest(`/api/admin/enrollments/${item.id}`, {
                                    method: 'PATCH',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ status: 'rejected' }),
                                  }),
                                'تم رفض الطلب'
                              )
                            }
                          >
                            <X /> رفض
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ══ RESULTS ═══════════════════════════════════════════════════════ */}
        {tab === 'results' && (
          <section className="dashboard-panel">
            <div className="panel-title">
              <BarChart3 />
              <div>
                <h2>نتائج الطلاب</h2>
                <p>التصحيح الآلي قابل للمراجعة والتعديل من المدرس</p>
              </div>
            </div>
            <div className="results-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الطالب</th>
                    <th>الامتحان</th>
                    <th>الدرجة</th>
                    <th>طريقة التصحيح</th>
                    <th>مراجعة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>{attempt.userEmail}</td>
                      <td>{attempt.examTitle}</td>
                      <td>
                        {attempt.score} / {attempt.maxScore}
                      </td>
                      <td>
                        {attempt.gradingMethod === 'ai'
                          ? 'ذكاء اصطناعي'
                          : attempt.gradingMethod === 'teacher_review'
                            ? 'مراجعة المدرس'
                            : 'قواعد تلقائية'}
                      </td>
                      <td>
                        <button
                          className="table-edit"
                          onClick={() => {
                            openPrompt({
                              title: `مراجعة وتعديل نتيجة ${attempt.userEmail}`,
                              fields: [
                                {
                                  name: 'score',
                                  label: `الدرجة الجديدة من ${attempt.maxScore}`,
                                  defaultValue: String(attempt.score),
                                  type: 'number',
                                },
                                { name: 'feedback', label: 'ملاحظة المدرس', defaultValue: '' },
                              ],
                              onSubmit: (v) => {
                                void mutate(
                                  () =>
                                    apiRequest(`/api/admin/attempts/${attempt.id}`, {
                                      method: 'PATCH',
                                      headers: { 'content-type': 'application/json' },
                                      body: JSON.stringify({
                                        score: v.score,
                                        feedback: v.feedback,
                                      }),
                                    }),
                                  'تم حفظ مراجعة المدرس'
                                );
                              },
                            });
                          }}
                        >
                          <PencilLine /> تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ══ MESSAGES ══════════════════════════════════════════════════════ */}
        {tab === 'messages' && (
          <section className="dashboard-panel">
            <div className="panel-title">
              <Mail />
              <div>
                <h2>رسائل التواصل</h2>
                <p>رسائل الطلاب وأولياء الأمور</p>
              </div>
            </div>
            <div className="message-grid">
              {data.contacts.map((message) => (
                <article key={message.id} className={message.status === 'new' ? 'message-new' : ''}>
                  <div>
                    <strong>{message.name}</strong>
                    <a href={`tel:${message.phone}`}>{message.phone}</a>
                    <span
                      className={`status-pill status-${message.status === 'new' ? 'pending' : 'approved'}`}
                    >
                      {message.status === 'new' ? 'جديد' : 'تمت المراجعة'}
                    </span>
                  </div>
                  <p>{message.message}</p>
                  <div className="message-footer">
                    <time>{new Date(message.createdAt).toLocaleDateString('ar-EG')}</time>
                    {message.status === 'new' && (
                      <button
                        className="status-button"
                        onClick={() =>
                          void mutate(
                            () =>
                              apiRequest(`/api/admin/contacts/${message.id}`, {
                                method: 'PATCH',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ status: 'reviewed' }),
                              }),
                            'تمت مراجعة الرسالة'
                          )
                        }
                      >
                        تحديد كـ&quot;تمت المراجعة&quot;
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ══ STAFF ═════════════════════════════════════════════════════════ */}
        {tab === 'staff' && can('manage_staff') && <StaffManager actorEmail={data.admin.email} />}
      </div>

      {/* ── Prompt modal ────────────────────────────────────────────────────── */}
      {promptModal.isOpen && (
        <div
          className="modal-backdrop"
          dir="rtl"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <form
            className="dashboard-panel"
            style={{ width: 'min(460px, 100%)', padding: '24px', margin: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const values: Record<string, string> = {};
              promptModal.fields.forEach((f) => {
                values[f.name] = (fd.get(f.name) as string) || '';
              });
              promptModal.onSubmit(values);
              closeModal();
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: '800' }}>
              {promptModal.title}
            </h3>
            {promptModal.fields.map((f) => (
              <label
                key={f.name}
                style={{
                  display: 'grid',
                  gap: '6px',
                  marginBottom: '14px',
                  fontSize: '13px',
                  color: 'var(--text)',
                }}
              >
                <span>{f.label}</span>
                <input
                  name={f.name}
                  type={f.type || 'text'}
                  defaultValue={f.defaultValue || ''}
                  required
                  className="auth-input"
                  style={{ width: '100%' }}
                />
              </label>
            ))}
            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end',
                marginTop: '20px',
              }}
            >
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                إلغاء
              </button>
              <button type="submit" className="btn btn-primary">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── ExamBuilder ──────────────────────────────────────────────────────────────

function ExamBuilder({
  courses,
  questions,
  setQuestions,
  busy,
  onSubmit,
}: {
  courses: Course[];
  questions: QuestionDraft[];
  setQuestions: (v: QuestionDraft[]) => void;
  busy: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const update = (index: number, patch: Partial<QuestionDraft>) =>
    setQuestions(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  return (
    <section className="dashboard-panel exam-builder">
      <div className="panel-title">
        <CirclePlus />
        <div>
          <h2>إضافة امتحان جديد</h2>
          <p>أسئلة اختيار من متعدد مع تحديد الإجابة الصحيحة والتصحيح التلقائي فور التسليم</p>
        </div>
      </div>
      <form className="stack-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label>
            اسم الامتحان
            <input name="title" required />
          </label>
          <label>
            الكورس
            <select name="courseId">
              <option value="">امتحان عام</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {c.grade}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          الوصف
          <textarea name="description" rows={2} />
        </label>
        <label>
          تعليمات الطالب
          <textarea name="instructions" rows={2} placeholder="اقرأ كل سؤال جيداً..." />
        </label>
        <div className="form-row three">
          <label>
            المدة بالدقائق
            <input name="durationMinutes" type="number" min="1" max="300" defaultValue="30" />
          </label>
          <label>
            نسبة النجاح %
            <input name="passingScore" type="number" min="0" max="100" defaultValue="50" />
          </label>
          <label>
            عدد المحاولات
            <input name="maxAttempts" type="number" min="1" max="10" defaultValue="3" />
          </label>
        </div>
        <label>
          الحالة
          <select name="status">
            <option value="draft">مسودة</option>
            <option value="published">منشور</option>
          </select>
        </label>
        <div className="question-editor-list">
          {questions.map((q, index) => (
            <article className="question-editor" key={index}>
              <header>
                <strong>السؤال {index + 1}</strong>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setQuestions(questions.filter((_, qi) => qi !== index))}
                  >
                    <Trash2 />
                  </button>
                )}
              </header>
              <div className="form-row">
                <label>
                  نوع السؤال
                  <div className="mcq-type-badge">
                    <ClipboardCheck /> اختيار من متعدد — تصحيح تلقائي
                  </div>
                </label>
                <label>
                  الدرجة
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={q.points}
                    onChange={(e) => update(index, { points: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label>
                نص السؤال
                <textarea
                  required
                  rows={2}
                  value={q.prompt}
                  onChange={(e) => update(index, { prompt: e.target.value })}
                />
              </label>
              <label>
                الاختيارات — كل اختيار في سطر
                <textarea
                  required
                  rows={4}
                  value={q.options}
                  onChange={(e) => update(index, { options: e.target.value })}
                  placeholder={'الإجابة الأولى\nالإجابة الثانية\nالإجابة الثالثة\nالإجابة الرابعة'}
                />
                <small>أضف اختيارين على الأقل، ثم اختر الإجابة الصحيحة بالأسفل.</small>
              </label>
              <label>
                الإجابة الصحيحة
                <select
                  required
                  value={q.correctAnswer}
                  onChange={(e) => update(index, { correctAnswer: e.target.value })}
                >
                  <option value="">اختر الإجابة الصحيحة</option>
                  {q.options
                    .split('\n')
                    .map((option) => option.trim())
                    .filter(Boolean)
                    .map((option, optionIndex) => (
                      <option key={`${option}-${optionIndex}`} value={option}>
                        {option}
                      </option>
                    ))}
                </select>
              </label>
            </article>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost add-question"
          onClick={() => setQuestions([...questions, emptyQuestion()])}
        >
          <CirclePlus /> إضافة سؤال
        </button>
        <button className="btn btn-primary btn-large" disabled={busy}>
          <Save /> حفظ الامتحان
        </button>
      </form>
    </section>
  );
}

// ─── VideoUploader (with XHR progress) ───────────────────────────────────────

function VideoUploader({
  courses,
  videos,
  busy,
  progressPct,
  uploadDone,
  xhrRef,
  onProgressPct,
  onUploadDone,
  onDone,
  onError,
}: {
  courses: Course[];
  videos: Video[];
  busy: boolean;
  progressPct: number | null;
  uploadDone: string;
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>;
  onProgressPct: (v: number | null) => void;
  onUploadDone: (v: string) => void;
  onDone: () => Promise<void>;
  onError: (v: string) => void;
}) {
  const [courseId, setCourseId] = useState('');
  const [sourceMode, setSourceMode] = useState<'youtube' | 'upload'>('youtube');
  const [linkBusy, setLinkBusy] = useState(false);
  const courseHasLessons = videos.some((video) => video.courseId === courseId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    if (sourceMode === 'youtube') {
      onError('');
      onUploadDone('');
      setLinkBusy(true);
      try {
        await apiRequest('/api/admin/videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId: fd.get('courseId'),
            title: fd.get('title'),
            durationSeconds: fd.get('durationSeconds'),
            youtubeUrl: fd.get('youtubeUrl'),
          }),
        });
        onUploadDone(String(fd.get('title') || 'فيديو YouTube'));
        form.reset();
        setCourseId('');
        await onDone();
      } catch (uploadError) {
        onError(uploadError instanceof Error ? uploadError.message : 'تعذر حفظ رابط YouTube');
      } finally {
        setLinkBusy(false);
      }
      return;
    }

    const file = fd.get('video');
    if (!(file instanceof File)) return;

    onError('');
    onUploadDone('');
    onProgressPct(0);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgressPct(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = async () => {
      xhrRef.current = null;
      onProgressPct(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const fileName = (file as File).name;
        onUploadDone(fileName);
        form.reset();
        setCourseId('');
        await onDone();
      } else {
        let errMsg = 'تعذر رفع الفيديو';
        try {
          errMsg = (JSON.parse(xhr.responseText) as { error?: string }).error || errMsg;
        } catch {
          /* ignore */
        }
        onError(errMsg);
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      onProgressPct(null);
      onError('تعذر الاتصال بالخادم أثناء رفع الفيديو');
    };

    xhr.open('POST', '/api/admin/videos');
    xhr.setRequestHeader('content-type', file.type);
    xhr.setRequestHeader('x-course-id', String(fd.get('courseId') || ''));
    xhr.setRequestHeader('x-video-title', encodeURIComponent(String(fd.get('title') || '')));
    xhr.setRequestHeader('x-video-duration', String(fd.get('durationSeconds') || '0'));
    xhr.send(file);
  };

  const cancelUpload = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    onProgressPct(null);
    onError('تم إلغاء الرفع');
  };

  return (
    <form className="stack-form" onSubmit={submit}>
      <div className="video-source-switch" role="group" aria-label="مصدر الفيديو">
        <button
          type="button"
          className={sourceMode === 'youtube' ? 'active' : ''}
          onClick={() => setSourceMode('youtube')}
        >
          رابط YouTube
        </button>
        <button
          type="button"
          className={sourceMode === 'upload' ? 'active' : ''}
          onClick={() => setSourceMode('upload')}
        >
          رفع ملف
        </button>
      </div>
      <label>
        الكورس
        <select
          name="courseId"
          required
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
        >
          <option value="">اختر الكورس</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} — {c.grade}
            </option>
          ))}
        </select>
      </label>
      <label>
        عنوان الفيديو
        <input name="title" required />
      </label>
      <label>
        المدة بالثواني
        <input name="durationSeconds" type="number" min="0" defaultValue="0" />
        <small>
          {courseHasLessons
            ? 'ستُفتح هذه المحاضرة بعد إنهاء المحاضرة السابقة.'
            : 'هذه أول محاضرة وستكون متاحة فورًا للطلاب المشتركين.'}
        </small>
      </label>
      {sourceMode === 'youtube' ? (
        <label>
          رابط الفيديو على YouTube
          <input
            name="youtubeUrl"
            type="url"
            dir="ltr"
            placeholder="https://youtu.be/..."
            required
          />
          <small className="youtube-unlisted-note">
            ارفع الفيديو على YouTube كـ «غير مدرج / Unlisted» ثم الصق الرابط هنا. الفيديو الخاص
            Private لن يعمل للطلاب إلا عند دعوتهم بحساباتهم على Google.
          </small>
        </label>
      ) : (
        <label className="file-drop">
          <Upload />
          <strong>اختر ملف MP4 أو WebM</strong>
          <small>يُحفظ في مساحة خاصة ويُبث للمشتركين فقط</small>
          <input name="video" type="file" accept="video/mp4,video/webm" required />
        </label>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────────── */}
      {progressPct !== null && (
        <div className="upload-progress-wrap">
          <div className="upload-progress-bar" style={{ width: `${progressPct}%` }} />
          <span className="upload-progress-label">{progressPct}% مرفوع</span>
          <button type="button" className="btn btn-ghost upload-cancel-btn" onClick={cancelUpload}>
            <X size={14} /> إلغاء
          </button>
        </div>
      )}

      {/* ── Success indicator ─────────────────────────────────────────────────── */}
      {uploadDone && (
        <div className="success-toast" style={{ marginTop: '0.5rem' }}>
          <Check size={14} /> تم رفع: {uploadDone}
        </div>
      )}

      <button className="btn btn-primary" disabled={busy || linkBusy || progressPct !== null}>
        <Upload />{' '}
        {progressPct !== null
          ? `جاري الرفع... ${progressPct}%`
          : linkBusy
            ? 'جاري حفظ الرابط...'
            : sourceMode === 'youtube'
              ? 'حفظ رابط YouTube'
              : 'رفع وتأمين الفيديو'}
      </button>
    </form>
  );
}

// ─── StaffManager ─────────────────────────────────────────────────────────────

function StaffManager({ actorEmail }: { actorEmail: string }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStaff = useCallback(async () => {
    try {
      const result = (await apiRequest('/api/admin/staff', { cache: 'no-store' })) as {
        staff: StaffAccount[];
      };
      setStaff(result.staff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل حسابات الفريق');
    }
  }, []);

  useEffect(() => {
    // Initial team-account synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStaff();
  }, [loadStaff]);

  const update = async (email: string, body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/admin/staff/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNotice(success);
      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'تعذر تحديث الحساب');
    } finally {
      setBusy(false);
    }
  };

  const deleteStaff = async (email: string) => {
    if (!confirm(`هل أنت متأكد من حذف حساب ${email}؟`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/staff/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'تعذر حذف الحساب');
      }
      setNotice('تم حذف الحساب');
      await loadStaff();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'تعذر حذف الحساب');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-split">
      <section className="dashboard-panel">
        <div className="panel-title">
          <UserCog />
          <div>
            <h2>إنشاء حساب فريق</h2>
            <p>لا يمكن لأي شخص التسجيل كمدرس أو مساعد. الحسابات تُنشأ من هنا فقط.</p>
          </div>
        </div>
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setNotice('');
            const form = event.currentTarget;
            try {
              await apiRequest('/api/admin/staff', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
              });
              setNotice('تم إنشاء حساب الفريق');
              form.reset();
              await loadStaff();
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : 'تعذر إنشاء الحساب');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            الاسم
            <input name="name" required minLength={2} />
          </label>
          <label>
            البريد الخاص بالدخول
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <label>
            كلمة مرور مؤقتة
            <input
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          <label>
            نوع الحساب
            <select name="role" defaultValue="assistant">
              <option value="assistant">مساعد</option>
              <option value="teacher">مدرس — صلاحية كاملة</option>
            </select>
          </label>
          <label>
            صلاحيات المساعد
            <select name="preset" defaultValue="grader">
              <option value="grader">التصحيح والدرجات فقط</option>
              <option value="course_manager">الكورسات والامتحانات والمحاضرات</option>
              <option value="enrollment_manager">الطلاب والاشتراكات</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy}>
            <UserCog /> إنشاء الحساب
          </button>
        </form>
        {notice && (
          <div className="success-toast">
            <Check /> {notice}
          </div>
        )}
        {error && (
          <div className="error-toast">
            <X /> {error}
          </div>
        )}
      </section>

      <section className="dashboard-panel wide-panel">
        <div className="panel-title">
          <ShieldCheck />
          <div>
            <h2>حسابات المدرسين والمساعدين</h2>
            <p>تعطيل الحساب يوقف دخوله فور انتهاء جلسته؛ تغيير كلمة المرور ينهي كل جلساته.</p>
          </div>
        </div>
        <div className="management-list">
          {staff.map((account) => {
            let permissions: string[] = [];
            try {
              permissions = JSON.parse(account.permissions) as string[];
            } catch {
              permissions = [];
            }
            return (
              <article key={account.email}>
                <div>
                  <strong>{account.name}</strong>
                  <small>
                    {account.role === 'teacher'
                      ? 'مدرس — صلاحية كاملة'
                      : permissionLabel(permissions)}{' '}
                    · {account.email}
                  </small>
                </div>
                <div className="list-actions">
                  <span
                    className={`status-pill status-${account.active ? 'approved' : 'rejected'}`}
                  >
                    {account.active ? 'نشط' : 'موقوف'}
                  </span>
                  {account.email !== actorEmail && (
                    <button
                      className="status-button"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          account.email,
                          {
                            active: !account.active,
                            role: account.role,
                            preset: presetFor(permissions),
                          },
                          account.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'
                        )
                      }
                    >
                      {account.active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  )}
                  {account.role === 'assistant' && (
                    <select
                      className="status-button"
                      value={presetFor(permissions)}
                      disabled={busy}
                      onChange={(e) =>
                        void update(
                          account.email,
                          {
                            active: Boolean(account.active),
                            role: 'assistant',
                            preset: e.target.value,
                          },
                          'تم تحديث صلاحيات المساعد'
                        )
                      }
                    >
                      <option value="grader">الدرجات فقط</option>
                      <option value="course_manager">الكورسات فقط</option>
                      <option value="enrollment_manager">الاشتراكات فقط</option>
                    </select>
                  )}
                  <button
                    className="status-button"
                    disabled={busy}
                    onClick={() => {
                      const newPassword = window.prompt('كلمة المرور الجديدة (12 حرفاً على الأقل)');
                      if (!newPassword || newPassword.trim().length < 12) return;
                      void update(
                        account.email,
                        {
                          password: newPassword.trim(),
                          active: Boolean(account.active),
                          role: account.role,
                          preset: presetFor(permissions),
                        },
                        'تم تغيير كلمة المرور وإنهاء الجلسات القديمة'
                      );
                    }}
                  >
                    تغيير كلمة المرور
                  </button>
                  {account.email !== actorEmail && (
                    <button
                      className="icon-button danger"
                      disabled={busy}
                      aria-label="حذف الحساب"
                      onClick={() => void deleteStaff(account.email)}
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function presetFor(permissions: string[]): string {
  if (permissions.includes('manage_staff')) return 'full_access';
  if (permissions.includes('manage_courses')) return 'course_manager';
  if (permissions.includes('manage_enrollments')) return 'enrollment_manager';
  return 'grader';
}

function permissionLabel(permissions: string[]): string {
  const preset = presetFor(permissions);
  if (preset === 'course_manager') return 'مساعد كورسات وامتحانات';
  if (preset === 'enrollment_manager') return 'مساعد طلاب واشتراكات';
  return 'مساعد تصحيح ودرجات';
}

// ─── StudentsPanel ────────────────────────────────────────────────────────────

function StudentsPanel() {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadStudents = useCallback(
    async (p = 1, q = search, g = grade) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(p), limit: '50' });
        if (q) params.set('q', q);
        if (g) params.set('grade', g);
        const res = (await apiRequest(`/api/admin/students?${params.toString()}`, {
          cache: 'no-store',
        })) as { students: Student[]; total: number; pages: number };
        setStudents(res.students);
        setTotal(res.total);
        setPages(res.pages);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الطلاب');
      } finally {
        setLoading(false);
      }
    },
    [search, grade]
  );

  // Load the initial unfiltered student list only once.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    // Initial students synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStudents(1, '', '');
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void loadStudents(1, search, grade);
  };

  return (
    <section className="dashboard-panel">
      <div className="panel-title">
        <GraduationCap />
        <div>
          <h2>قائمة الطلاب</h2>
          <p>{total} طالب مسجّل</p>
        </div>
      </div>
      <form
        className="student-search-bar"
        onSubmit={handleSearch}
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        <input
          placeholder="ابحث بالاسم أو البريد أو الموبايل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">كل الصفوف</option>
          <option>أولى ثانوي</option>
          <option>تانية ثانوي</option>
          <option>تالتة ثانوي</option>
        </select>
        <button className="btn btn-primary" type="submit">
          بحث
        </button>
      </form>
      {error && <div className="error-toast">{error}</div>}
      {loading && (
        <div className="dashboard-state">
          <LoaderCircle className="spin" /> جاري التحميل...
        </div>
      )}
      <div className="management-list">
        {students.map((student) => (
          <article key={student.email}>
            <div
              onClick={() => setExpanded(expanded === student.email ? null : student.email)}
              style={{ cursor: 'pointer' }}
            >
              <strong>{student.name || student.email}</strong>
              <small>
                {student.grade}
                {student.section ? ` — ${student.section}` : ''} · {student.governorate} ·{' '}
                {student.activeEnrollments} اشتراك · {student.totalAttempts} محاولة
              </small>
              <small style={{ opacity: 0.6 }}>{student.email}</small>
            </div>
            {expanded === student.email && (
              <div
                className="student-detail-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  background: 'var(--surface-2, rgba(0,0,0,0.05))',
                  borderRadius: '8px',
                  marginTop: '0.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <b>الموبايل:</b> {student.phone || '—'}
                </div>
                <div>
                  <b>هاتف الأب:</b> {student.fatherPhone || '—'}
                </div>
                <div>
                  <b>هاتف الأم:</b> {student.motherPhone || '—'}
                </div>
                <div>
                  <b>المدرسة:</b> {student.schoolName || '—'}
                </div>
                <div>
                  <b>المحافظة:</b> {student.governorate || '—'}
                </div>
                <div>
                  <b>النوع:</b> {student.gender || '—'}
                </div>
                <div>
                  <b>الصف:</b> {student.grade} {student.section}
                </div>
                <div>
                  <b>تاريخ التسجيل:</b>{' '}
                  {student.createdAt
                    ? new Date(student.createdAt).toLocaleDateString('ar-EG')
                    : '—'}
                </div>
              </div>
            )}
          </article>
        ))}
        {!loading && students.length === 0 && <div className="empty-state">لا توجد نتائج.</div>}
      </div>
      {pages > 1 && (
        <div
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}
        >
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => void loadStudents(page - 1)}
          >
            السابق
          </button>
          <span style={{ lineHeight: '2.5rem' }}>
            صفحة {page} من {pages}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= pages}
            onClick={() => void loadStudents(page + 1)}
          >
            التالي
          </button>
        </div>
      )}
    </section>
  );
}
