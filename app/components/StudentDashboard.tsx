'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  FileText,
  GraduationCap,
  Home,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Medal,
  Play,
  ShieldCheck,
  Upload,
  UserRound,
  Trophy,
  X,
} from 'lucide-react';

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}
import EmailVerification from './EmailVerification';
import LectureCodeRedemption from './LectureCodeRedemption';

type DashboardData = {
  verificationRequired: boolean;
  user: {
    email: string;
    displayName: string;
    profile?: { name?: string; phone?: string; grade?: string } | null;
  };
  enrollments: Array<{
    id: string;
    courseId: string;
    title: string;
    grade: string;
    status: string;
  }>;
  exams: Array<{
    id: string;
    courseId?: string | null;
    title: string;
    description: string;
    durationMinutes: number;
    courseTitle?: string;
    maxScore: number;
    passingScore: number;
    maxAttempts: number;
    attemptCount: number;
    bestPercentage: number;
    isRead: number;
  }>;
  assignments: Array<{
    id: string;
    courseId: string;
    courseTitle: string;
    title: string;
    description: string;
    dueAt?: number | null;
    maxScore: number;
    isRead: number;
  }>;
  attempts: Array<{
    id: string;
    examId: string;
    title: string;
    score: number;
    maxScore: number;
    feedback: string;
    submittedAt: number;
  }>;
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    createdAt: number;
    isRead: number;
  }>;
  lectureAccess: Array<{
    videoId: string;
    videoTitle: string;
    courseId: string;
    courseTitle: string;
    grantedAt: number;
  }>;
  leaderboards: Record<
    string,
    Array<{
      rank: number;
      name: string;
      averagePercentage: number;
      examsCompleted: number;
      isCurrentStudent: boolean;
    }>
  >;
};
type View =
  | 'home'
  | 'course'
  | 'redeem'
  | 'exams'
  | 'assignments'
  | 'grades'
  | 'leaderboard'
  | 'profile'
  | 'security';
const LEADERBOARD_GRADES = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];
function percent(score: number, maxScore: number) {
  return maxScore > 0 ? Math.round((score * 100) / maxScore) : 0;
}

type AssignmentRow = DashboardData['assignments'][number];

type AssignmentDetail = {
  assignment: {
    id: string;
    type: string;
    hasTeacherFile: number;
    maxScore: number;
  };
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    points: number;
    sortOrder: number;
  }>;
  submission: {
    id: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    feedback: string;
    submittedAt: number;
    hasPdf: number;
  } | null;
};

function StudentAssignmentCard({ assignment }: { assignment: AssignmentRow }) {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/student/assignments/${assignment.id}`);
      if (res.ok) {
        const d = (await res.json()) as AssignmentDetail;
        setDetail(d);
      }
    } finally {
      setLoading(false);
    }
  }, [assignment.id]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) void loadDetail();
  };

  const handlePdfSubmit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg('اختر ملف PDF أولاً');
      setMsgType('err');
      return;
    }
    if (!file.type.includes('pdf')) {
      setMsg('يجب رفع ملف PDF فقط');
      setMsgType('err');
      return;
    }
    setBusy(true);
    setMsg('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`/api/student/assignments/${assignment.id}/submit`, {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        setMsg('تم إرسال إجابتك بنجاح! سيتم مراجعتها وتصحيحها.');
        setMsgType('ok');
        void loadDetail();
      } else {
        const err = (await res.json()) as { error?: string };
        setMsg(err.error || 'تعذر إرسال الإجابة');
        setMsgType('err');
      }
    } catch {
      setMsg('خطأ في الاتصال بالخادم');
      setMsgType('err');
    }
    setBusy(false);
  };

  const handleMcqSubmit = async () => {
    if (!detail) return;
    const unanswered = detail.questions.filter((q) => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      setMsg(`يرجى الإجابة على جميع الأسئلة (متبقي ${unanswered.length} سؤال)`);
      setMsgType('err');
      return;
    }
    setBusy(true);
    setMsg('');
    const ansArray = Object.entries(answers).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));
    try {
      const res = await fetch(`/api/student/assignments/${assignment.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: ansArray }),
      });
      if (res.ok) {
        const result = (await res.json()) as {
          score: number;
          maxScore: number;
          percentage: number;
        };
        setMsg(`تم التسليم بنجاح! درجتك: ${result.score} من ${result.maxScore} (${result.percentage}%)`);
        setMsgType('ok');
        void loadDetail();
      } else {
        const err = (await res.json()) as { error?: string };
        setMsg(err.error || 'تعذر إرسال الإجابات');
        setMsgType('err');
      }
    } catch {
      setMsg('خطأ في الاتصال بالخادم');
      setMsgType('err');
    }
    setBusy(false);
  };

  const sub = detail?.submission;
  const type = detail?.assignment?.type || 'pdf';

  return (
    <article className="exam-row detailed" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <span className="exam-date">
            <FileText />
            <small>{type === 'mcq' ? 'MCQ' : type === 'generic' ? 'عام' : 'PDF'}</small>
          </span>
          <div className="exam-copy">
            <strong>{assignment.title}</strong>
            <small>
              {assignment.courseTitle} ·{' '}
              {assignment.dueAt
                ? `موعد التسليم: ${new Date(assignment.dueAt).toLocaleString('ar-EG')}`
                : 'بدون موعد تسليم'}
              {assignment.maxScore > 0 ? ` · ${assignment.maxScore} درجة` : ''}
            </small>
            {assignment.description && <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)' }}>{assignment.description}</p>}
            {sub && (
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {sub.status === 'graded' ? (
                  <span className="status-pill status-approved" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <CheckCircle2 size={12} /> تم التصحيح: {sub.score} / {sub.maxScore || assignment.maxScore}
                    {sub.feedback ? ` — ${sub.feedback}` : ''}
                  </span>
                ) : (
                  <span className="status-pill status-pending" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Clock3 size={12} /> تم التسليم — بانتظار المراجعة والتصحيح
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem', flexShrink: 0 }}>
          {!assignment.isRead && <span className="status-pill status-pending">جديد</span>}
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            onClick={handleToggle}
            aria-expanded={expanded}
          >
            {expanded ? 'إخفاء التفاصيل' : 'فتح الواجب'}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '0.75rem',
            marginTop: '0.25rem',
            width: '100%',
          }}
        >
          {loading && <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>جاري تحميل تفاصيل الواجب...</p>}
          {msg && (
            <p
              style={{
                color: msgType === 'ok' ? '#10b981' : '#ef4444',
                fontSize: '0.875rem',
                margin: '0.5rem 0',
                padding: '0.5rem',
                borderRadius: '6px',
                background: msgType === 'ok' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              }}
            >
              {msg}
            </p>
          )}

          {detail && !sub && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {detail.assignment.hasTeacherFile === 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <a
                    href={`/api/student/assignments/${assignment.id}/teacher-file`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.85rem' }}
                  >
                    <Download size={14} /> تحميل ملف أسئلة الواجب (PDF)
                  </a>
                </div>
              )}

              {type === 'pdf' && (
                <div style={{ background: 'var(--surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                    رفع إجابتك (ملف PDF، بحد أقصى 15 ميجابايت):
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <label className="btn btn-outline" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                      <Upload size={14} /> اختيار ملف PDF
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        style={{ display: 'none' }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.85rem' }}
                      onClick={() => void handlePdfSubmit()}
                      disabled={busy}
                    >
                      {busy ? 'جاري الإرسال...' : 'إرسال الإجابة الآن'}
                    </button>
                  </div>
                </div>
              )}

              {type === 'mcq' && detail.questions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {detail.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      style={{
                        padding: '0.75rem',
                        background: 'var(--surface)',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
                        س{idx + 1}: {q.question}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginInlineStart: '0.5rem', fontWeight: 400 }}>
                          ({q.points} درجة)
                        </span>
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {q.options.map((opt, i) => (
                          <button
                            type="button"
                            key={i}
                            className={`btn ${answers[q.id] === i ? 'btn-primary' : 'btn-outline'}`}
                            style={{
                              textAlign: 'start',
                              justifyContent: 'flex-start',
                              fontSize: '0.85rem',
                              padding: '0.4rem 0.75rem',
                            }}
                            onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => void handleMcqSubmit()}
                    disabled={busy}
                  >
                    {busy ? 'جاري التسليم...' : 'تسليم إجابات الواجب'}
                  </button>
                </div>
              )}

              {type === 'generic' && (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0 }}>
                  هذا واجب متابعة عام — يرجى اتباع تعليمات المدرس للتسليم.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function StudentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('home');
  const [activeCourseId, setActiveCourseId] = useState('');
  const [coursesOpen, setCoursesOpen] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [saved, setSaved] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteErr, setDeleteErr] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leaderboardGrade, setLeaderboardGrade] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    const result = (await response.json().catch(() => ({}))) as DashboardData & { error?: string };
    if (!response.ok) return setError(result.error || 'تعذر تحميل حسابك');
    setData(result);
  }, []);
  useEffect(() => {
    // Initial remote dashboard synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'leaderboard') {
      // Open the requested dashboard section when linked from the main navbar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView('leaderboard');
    }
  }, []);

  const approved = useMemo(
    () => data?.enrollments.filter((item) => item.status === 'approved') ?? [],
    [data]
  );
  const activeCourse = approved.find((item) => item.courseId === activeCourseId) ?? approved[0];
  const activeCourseExams =
    data?.exams.filter((exam) => !exam.courseId || exam.courseId === activeCourse?.courseId) ?? [];
  const visibleExams = activeCourseId ? activeCourseExams : (data?.exams ?? []);
  const visibleExamIds = new Set(visibleExams.map((exam) => exam.id));
  const visibleAttempts = activeCourseId
    ? (data?.attempts.filter((attempt) => visibleExamIds.has(attempt.examId)) ?? [])
    : (data?.attempts ?? []);
  const visibleAssignments = activeCourseId
    ? (data?.assignments.filter((assignment) => assignment.courseId === activeCourseId) ?? [])
    : (data?.assignments ?? []);
  const visibleAverage = visibleAttempts.length
    ? Math.round(
        visibleAttempts.reduce((sum, item) => sum + percent(item.score, item.maxScore), 0) /
          visibleAttempts.length
      )
    : 0;
  const average = data?.attempts.length
    ? Math.round(
        data.attempts.reduce((sum, item) => sum + percent(item.score, item.maxScore), 0) /
          data.attempts.length
      )
    : 0;
  const markNotificationsRead = useCallback(
    async (
      types: Array<'announcement' | 'exam' | 'assignment'> = ['announcement', 'exam', 'assignment']
    ) => {
      const response = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ types }),
      });
      if (!response.ok) return;
      setData((current) =>
        current
          ? {
              ...current,
              exams: types.includes('exam')
                ? current.exams.map((item) => ({ ...item, isRead: 1 }))
                : current.exams,
              assignments: types.includes('assignment')
                ? current.assignments.map((item) => ({ ...item, isRead: 1 }))
                : current.assignments,
              announcements: types.includes('announcement')
                ? current.announcements.map((item) => ({ ...item, isRead: 1 }))
                : current.announcements,
            }
          : current
      );
    },
    []
  );
  const navigate = (next: View, courseId?: string) => {
    if (courseId !== undefined) setActiveCourseId(courseId);
    if (next === 'exams') void markNotificationsRead(['exam']);
    if (next === 'assignments') void markNotificationsRead(['assignment']);
    setView(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error) return <div className="dashboard-state error-toast">{error}</div>;
  if (!data)
    return (
      <div className="dashboard-state">
        <LoaderCircle className="spin" /> جاري تجهيز مساحتك التعليمية...
      </div>
    );
  if (data.verificationRequired)
    return (
      <div className="dashboard-shell">
        <header className="dashboard-welcome">
          <div>
            <span className="section-label">مساحتي التعليمية</span>
            <h1>أهلًا، {data.user.displayName}</h1>
            <p>خطوة واحدة قبل فتح الكورسات والامتحانات.</p>
          </div>
          <button type="button" onClick={() => void logout()} className="btn btn-outline">
            تسجيل الخروج
          </button>
        </header>
        <EmailVerification email={data.user.email} onVerified={load} />
      </div>
    );

  const displayName = data.user.profile?.name || data.user.displayName;
  const pendingCount = data.enrollments.filter((item) => item.status === 'pending').length;
  const unreadCount =
    data.exams.filter((item) => !item.isRead).length +
    data.assignments.filter((item) => !item.isRead).length +
    data.announcements.filter((item) => !item.isRead).length;
  const sidebar = (
    <aside
      className={`student-sidebar ${mobileMenu ? 'is-open' : ''}`}
      aria-label="قائمة مساحة الطالب"
    >
      <div className="student-profile-mini">
        <div className="student-avatar">{displayName.trim().charAt(0).toUpperCase()}</div>
        <div>
          <strong>{displayName}</strong>
          <span>{data.user.profile?.grade || 'طالب إنجليزيكا'}</span>
        </div>
        <button
          className="sidebar-close"
          onClick={() => setMobileMenu(false)}
          aria-label="إغلاق القائمة"
        >
          <X />
        </button>
      </div>
      <nav className="student-nav">
        <button className={view === 'home' ? 'active' : ''} onClick={() => navigate('home')}>
          <LayoutDashboard />
          <span>الرئيسية</span>
        </button>
        <div className="sidebar-course-group">
          <button
            className={view === 'course' ? 'active' : ''}
            onClick={() => setCoursesOpen((value) => !value)}
          >
            <BookOpen />
            <span>كورساتي</span>
            <ChevronDown className={coursesOpen ? 'rotate' : ''} />
          </button>
          {coursesOpen && (
            <div className="sidebar-course-list">
              {approved.length ? (
                approved.map((course) => (
                  <button
                    key={course.id}
                    className={
                      view === 'course' && activeCourse?.courseId === course.courseId
                        ? 'selected'
                        : ''
                    }
                    onClick={() => navigate('course', course.courseId)}
                  >
                    <span>{course.title}</span>
                    <small>{course.grade}</small>
                  </button>
                ))
              ) : (
                <p>لا توجد كورسات مفعّلة</p>
              )}
            </div>
          )}
        </div>
        <button className={view === 'redeem' ? 'active' : ''} onClick={() => navigate('redeem')}>
          <KeyRound />
          <span>كود المحاضرة</span>
        </button>
        <button className={view === 'exams' ? 'active' : ''} onClick={() => navigate('exams', '')}>
          <ClipboardCheck />
          <span>الامتحانات</span>
          {data.exams.filter((item) => !item.isRead).length > 0 && (
            <b>{data.exams.filter((item) => !item.isRead).length}</b>
          )}
        </button>
        <button
          className={view === 'assignments' ? 'active' : ''}
          onClick={() => navigate('assignments', '')}
        >
          <FileText />
          <span>الواجبات</span>
          {data.assignments.filter((item) => !item.isRead).length > 0 && (
            <b>{data.assignments.filter((item) => !item.isRead).length}</b>
          )}
        </button>
        <button
          className={view === 'grades' ? 'active' : ''}
          onClick={() => navigate('grades', '')}
        >
          <BarChart3 />
          <span>الدرجات</span>
        </button>
        <button
          className={view === 'leaderboard' ? 'active' : ''}
          onClick={() => navigate('leaderboard', '')}
        >
          <Trophy />
          <span>أوائل كل صف</span>
        </button>
        <div className="sidebar-divider" />
        <button className={view === 'profile' ? 'active' : ''} onClick={() => navigate('profile')}>
          <UserRound />
          <span>بيانات الحساب</span>
        </button>
        <button
          className={view === 'security' ? 'active' : ''}
          onClick={() => navigate('security')}
        >
          <ShieldCheck />
          <span>الأمان وكلمة السر</span>
        </button>
      </nav>
      <div className="student-sidebar-bottom">
        <button type="button" onClick={() => void logout()}>
          <LogOut />
          <span>تسجيل الخروج</span>
        </button>
        <small>Englizeka Student Portal</small>
      </div>
    </aside>
  );

  return (
    <div className="student-portal-layout">
      {sidebar}
      {mobileMenu && (
        <button
          className="student-sidebar-overlay"
          onClick={() => setMobileMenu(false)}
          aria-label="إغلاق القائمة"
        />
      )}
      <main className="student-workspace">
        <header className="student-topbar">
          <button
            className="student-menu-button"
            onClick={() => setMobileMenu(true)}
            aria-label="فتح القائمة"
          >
            <Menu />
          </button>
          <div>
            <span>مساحتي التعليمية</span>
            <strong>
              {view === 'home'
                ? 'الرئيسية'
                : view === 'course'
                  ? activeCourse?.title || 'الكورس'
                  : view === 'redeem'
                    ? 'استخدام كود المحاضرة'
                    : view === 'exams'
                      ? 'الامتحانات'
                      : view === 'assignments'
                      ? 'الواجبات'
                      : view === 'grades'
                        ? 'الدرجات'
                        : view === 'leaderboard'
                          ? 'أوائل الطلاب'
                          : view === 'profile'
                            ? 'بيانات الحساب'
                            : 'الأمان وكلمة السر'}
            </strong>
          </div>
          <button
            className="notification-button"
            aria-label="الإشعارات"
            title={unreadCount ? `${unreadCount} إشعارات جديدة` : 'لا توجد إشعارات جديدة'}
            onClick={() => {
              navigate('home');
              void markNotificationsRead();
            }}
          >
            <Bell />
            {unreadCount > 0 && <i />}
          </button>
        </header>
        {view === 'home' && (
          <div className="student-view">
            <section className="student-hero">
              <div>
                <span className="student-eyebrow">
                  <Home /> لوحة الطالب
                </span>
                <h1>أهلًا، {displayName.split(' ')[0] || displayName}</h1>
                <p>كل دروسك وامتحاناتك ودرجاتك في مكان واحد. كمّل من حيث توقفت.</p>
                {approved[0] && (
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate('course', approved[0].courseId)}
                  >
                    استكمل التعلم <ArrowLeft />
                  </button>
                )}
              </div>
              <div className="hero-progress-card">
                <span>متوسط درجاتك</span>
                <strong>{average}%</strong>
                <div>
                  <i style={{ width: `${average}%` }} />
                </div>
                <small>
                  {data.attempts.length
                    ? `${data.attempts.length} اختبارات مكتملة`
                    : 'ابدأ أول امتحان لعرض تقدمك'}
                </small>
              </div>
            </section>
            <section className="student-section">
              <div className="student-section-heading">
                <div>
                  <span>تابع مذاكرتك</span>
                  <h2>الكورسات المسجل بها</h2>
                </div>
                <Link href="/courses">
                  استكشف كورسات أخرى <ArrowLeft />
                </Link>
              </div>
              {approved.length ? (
                <div className="enrolled-course-grid">
                  {approved.map((course, index) => {
                    const courseExams = data.exams.filter(
                      (exam) => !exam.courseId || exam.courseId === course.courseId
                    );
                    return (
                      <article
                        className={`enrolled-course-card course-tone-${index % 3}`}
                        key={course.id}
                      >
                        <div className="course-card-top">
                          <span>
                            <BookOpen />
                          </span>
                          <small>{course.grade}</small>
                        </div>
                        <div>
                          <h3>{course.title}</h3>
                          <p>{courseExams.length} امتحانات متاحة · محتوى مفعّل</p>
                        </div>
                        <div className="course-card-progress">
                          <div>
                            <i
                              style={{
                                width: data.attempts.length
                                  ? `${Math.min(82, 28 + data.attempts.length * 9)}%`
                                  : '12%',
                              }}
                            />
                          </div>
                        </div>
                        <div className="course-card-actions">
                          <button onClick={() => navigate('course', course.courseId)}>
                            تفاصيل الكورس
                          </button>
                          <Link
                            href={`/learn/${course.courseId}`}
                            aria-label={`ابدأ ${course.title}`}
                          >
                            <Play />
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="student-empty">
                  <BookOpen />
                  <h3>لا توجد كورسات مفعّلة حتى الآن</h3>
                  <p>عند تفعيل اشتراكك سيظهر الكورس هنا مباشرة.</p>
                  <Link className="btn btn-primary" href="/courses">
                    تصفح الكورسات
                  </Link>
                </div>
              )}
            </section>
            {data.lectureAccess.length > 0 && (
              <section className="student-card granted-lectures-card">
                <div className="student-card-title">
                  <div>
                    <KeyRound />
                    <span>
                      <small>وصول بكود المحاضرة</small>
                      <strong>المحاضرات المفتوحة لك</strong>
                    </span>
                  </div>
                  <button onClick={() => navigate('redeem')}>استخدام كود آخر</button>
                </div>
                <div className="granted-lecture-list">
                  {data.lectureAccess.map((lecture) => (
                    <article key={lecture.videoId}>
                      <span>
                        <strong>{lecture.videoTitle}</strong>
                        <small>{lecture.courseTitle}</small>
                      </span>
                      <Link href={`/learn/${lecture.courseId}?video=${encodeURIComponent(lecture.videoId)}`}>
                        مشاهدة <Play />
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <section className="student-overview-grid">
              <article className="student-card upcoming-card">
                <div className="student-card-title">
                  <div>
                    <ClipboardCheck />
                    <span>
                      <small>جاهز للمحاولة؟</small>
                      <strong>الامتحانات القادمة</strong>
                    </span>
                  </div>
                  <button onClick={() => navigate('exams', '')}>عرض الكل</button>
                </div>
                {data.exams.length ? (
                  data.exams.slice(0, 3).map((exam) => <ExamRow key={exam.id} exam={exam} />)
                ) : (
                  <div className="compact-empty">لا توجد امتحانات متاحة حاليًا.</div>
                )}
              </article>
              <article className="student-card activity-card">
                <div className="student-card-title">
                  <div>
                    <BarChart3 />
                    <span>
                      <small>أداؤك الدراسي</small>
                      <strong>ملخص التقدم</strong>
                    </span>
                  </div>
                </div>
                <div className="activity-stats">
                  <div>
                    <strong>{approved.length}</strong>
                    <span>كورسات</span>
                  </div>
                  <div>
                    <strong>{data.attempts.length}</strong>
                    <span>اختبارات</span>
                  </div>
                  <div>
                    <strong>{average}%</strong>
                    <span>المتوسط</span>
                  </div>
                </div>
                {pendingCount > 0 ? (
                  <p className="pending-note">
                    <Clock3 /> لديك {pendingCount} طلب اشتراك قيد المراجعة
                  </p>
                ) : (
                  <p className="success-note">
                    <CheckCircle2 /> حسابك محدث وجاهز للتعلم
                  </p>
                )}
              </article>
            </section>
            {data.announcements.length > 0 && (
              <section className="student-card announcement-card">
                <div className="student-card-title">
                  <div>
                    <Bell />
                    <span>
                      <small>آخر الأخبار</small>
                      <strong>إعلانات مهمة</strong>
                    </span>
                  </div>
                </div>
                <div>
                  {data.announcements.slice(0, 3).map((item) => (
                    <article key={item.id}>
                      <strong>{item.title}</strong>
                      {!item.isRead && <small className="status-pill status-pending">جديد</small>}
                      <p>{item.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {view === 'redeem' && (
          <div className="student-view">
            <LectureCodeRedemption onRedeemed={load} />
            {data.lectureAccess.length > 0 && (
              <section className="student-card granted-lectures-card">
                <div className="student-card-title">
                  <div>
                    <Play />
                    <span>
                      <small>وصول دائم</small>
                      <strong>محاضراتك المفتوحة بالكود</strong>
                    </span>
                  </div>
                </div>
                <div className="granted-lecture-list">
                  {data.lectureAccess.map((lecture) => (
                    <article key={lecture.videoId}>
                      <span>
                        <strong>{lecture.videoTitle}</strong>
                        <small>{lecture.courseTitle}</small>
                      </span>
                      <Link href={`/learn/${lecture.courseId}?video=${encodeURIComponent(lecture.videoId)}`}>
                        مشاهدة <Play />
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {view === 'course' && (
          <div className="student-view">
            {activeCourse ? (
              <>
                <section className="course-detail-hero">
                  <div>
                    <span>{activeCourse.grade}</span>
                    <h1>{activeCourse.title}</h1>
                    <p>افتح محتوى الكورس، راجع امتحاناته، وتابع درجاتك من نفس المكان.</p>
                  </div>
                  <Link className="btn btn-primary" href={`/learn/${activeCourse.courseId}`}>
                    دخول الكورس <Play />
                  </Link>
                </section>
                <div className="course-tools-grid">
                  <button onClick={() => navigate('exams', activeCourse.courseId)}>
                    <ClipboardCheck />
                    <span>
                      <strong>امتحانات الكورس</strong>
                      <small>{activeCourseExams.length} امتحانات متاحة</small>
                    </span>
                    <ArrowLeft />
                  </button>
                  <button onClick={() => navigate('assignments', activeCourse.courseId)}>
                    <FileText />
                    <span>
                      <strong>الواجبات</strong>
                      <small>تابع المطلوب ومواعيد التسليم</small>
                    </span>
                    <ArrowLeft />
                  </button>
                  <button onClick={() => navigate('grades', activeCourse.courseId)}>
                    <BarChart3 />
                    <span>
                      <strong>درجاتي</strong>
                      <small>نتائج الامتحانات والتقييمات</small>
                    </span>
                    <ArrowLeft />
                  </button>
                </div>
                <section className="student-card">
                  <div className="student-card-title">
                    <div>
                      <CalendarDays />
                      <span>
                        <small>خطة الكورس</small>
                        <strong>ابدأ رحلتك التعليمية</strong>
                      </span>
                    </div>
                  </div>
                  <div className="course-roadmap">
                    <article className="done">
                      <span>1</span>
                      <div>
                        <strong>ابدأ مشاهدة الدروس</strong>
                        <p>شاهد المحتوى بالترتيب واحفظ تقدمك.</p>
                      </div>
                      <CheckCircle2 />
                    </article>
                    <article>
                      <span>2</span>
                      <div>
                        <strong>حل الواجبات</strong>
                        <p>طبّق على كل وحدة قبل الانتقال لما بعدها.</p>
                      </div>
                      <FileText />
                    </article>
                    <article>
                      <span>3</span>
                      <div>
                        <strong>اختبر مستواك</strong>
                        <p>ادخل امتحان الكورس وراجع نتيجتك.</p>
                      </div>
                      <GraduationCap />
                    </article>
                  </div>
                </section>
              </>
            ) : (
              <div className="student-empty">
                <BookOpen />
                <h3>اختر كورسًا من القائمة</h3>
              </div>
            )}
          </div>
        )}
        {view === 'exams' && (
          <ListPage
            icon={<ClipboardCheck />}
            eyebrow="قيّم مستواك"
            title="الامتحانات"
            description={
              activeCourseId
                ? `امتحانات ${activeCourse?.title || 'الكورس'} مع عدد المحاولات وأفضل نتيجة.`
                : 'كل امتحانات كورساتك المفعّلة، مع عدد المحاولات وأفضل نتيجة.'
            }
          >
            {visibleExams.length ? (
              <div className="full-list">
                {visibleExams.map((exam) => (
                  <ExamRow key={exam.id} exam={exam} detailed />
                ))}
              </div>
            ) : (
              <EmptyPanel
                icon={<ClipboardCheck />}
                title="لا توجد امتحانات متاحة"
                text="ستظهر الامتحانات الجديدة هنا بمجرد نشرها."
              />
            )}
          </ListPage>
        )}
        {view === 'assignments' && (
          <ListPage
            icon={<FileText />}
            eyebrow="طبّق على الدروس"
            title="الواجبات"
            description="مكان واحد لمتابعة واجبات كل كورس ونتائج التصحيح."
          >
            {visibleAssignments.length ? (
              <div className="full-list">
                {visibleAssignments.map((assignment) => (
                  <StudentAssignmentCard key={assignment.id} assignment={assignment} />
                ))}
              </div>
            ) : (
              <EmptyPanel
                icon={<FileText />}
                title="لا توجد واجبات مطلوبة الآن"
                text="أي واجب جديد يضيفه المدرس سيظهر هنا مع موعد التسليم والدرجة."
              />
            )}
          </ListPage>
        )}
        {view === 'grades' && (
          <ListPage
            icon={<BarChart3 />}
            eyebrow="تابع تقدمك"
            title="سجل الدرجات"
            description="نتائج الامتحانات والواجبات مرتبة في كشف درجات واضح."
          >
            {visibleAttempts.length ? (
              <div className="gradebook">
                <div className="gradebook-summary">
                  <span>المتوسط العام</span>
                  <strong>{visibleAverage}%</strong>
                  <small>{visibleAttempts.length} نتائج مسجلة</small>
                </div>
                <div className="gradebook-table">
                  <div className="gradebook-head">
                    <span>التقييم</span>
                    <span>الدرجة</span>
                    <span>النسبة</span>
                    <span>التفاصيل</span>
                  </div>
                  {visibleAttempts.map((attempt) => (
                    <div className="gradebook-row" key={attempt.id}>
                      <span>
                        <strong>{attempt.title}</strong>
                        <small>{new Date(attempt.submittedAt).toLocaleDateString('ar-EG')}</small>
                      </span>
                      <span>
                        {attempt.score} / {attempt.maxScore}
                      </span>
                      <span>
                        <b>{percent(attempt.score, attempt.maxScore)}%</b>
                      </span>
                      <Link href={`/result/${attempt.id}`}>عرض النتيجة</Link>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyPanel
                icon={<BarChart3 />}
                title="لا توجد درجات بعد"
                text="بعد تسليم أول امتحان أو واجب ستظهر نتيجتك هنا."
              />
            )}
          </ListPage>
        )}
        {view === 'leaderboard' && (
          <ListPage
            icon={<Trophy />}
            eyebrow="نافس وتقدّم"
            title="أوائل الطلاب"
            description="أفضل 10 طلاب في كل صف، محسوبة من متوسط أفضل نتيجة للطالب في كل امتحان مكتمل."
          >
            <div className="leaderboard-tabs" role="tablist" aria-label="اختيار الصف الدراسي">
              {LEADERBOARD_GRADES.map((gradeName) => {
                const selectedGrade =
                  leaderboardGrade || data.user.profile?.grade || LEADERBOARD_GRADES[0];
                return (
                  <button
                    key={gradeName}
                    type="button"
                    className={selectedGrade === gradeName ? 'active' : ''}
                    onClick={() => setLeaderboardGrade(gradeName)}
                  >
                    {gradeName}
                  </button>
                );
              })}
            </div>
            {(() => {
              const selectedGrade =
                leaderboardGrade || data.user.profile?.grade || LEADERBOARD_GRADES[0];
              const leaders = data.leaderboards?.[selectedGrade] ?? [];
              if (!leaders.length) {
                return (
                  <EmptyPanel
                    icon={<Trophy />}
                    title="لا توجد نتائج كافية بعد"
                    text="تظهر قائمة الأوائل بعد إكمال الطلاب لأول امتحان في هذا الصف."
                  />
                );
              }
              return (
                <div className="leaderboard-list">
                  {leaders.map((student) => (
                    <article
                      key={`${selectedGrade}-${student.rank}-${student.name}`}
                      className={`${student.rank <= 3 ? `top-${student.rank}` : ''} ${student.isCurrentStudent ? 'is-current' : ''}`}
                    >
                      <div className="leaderboard-rank">
                        {student.rank <= 3 ? <Medal /> : <span>{student.rank}</span>}
                      </div>
                      <div className="leaderboard-name">
                        <strong>{student.name}</strong>
                        <small>
                          {student.examsCompleted} امتحانات مكتملة
                          {student.isCurrentStudent ? ' · أنت' : ''}
                        </small>
                      </div>
                      <div className="leaderboard-score">
                        <strong>{student.averagePercentage}%</strong>
                        <small>المتوسط</small>
                      </div>
                    </article>
                  ))}
                </div>
              );
            })()}
          </ListPage>
        )}
        {view === 'profile' && (
          <ListPage
            icon={<UserRound />}
            eyebrow="حسابك"
            title="بيانات الطالب"
            description="حافظ على بياناتك محدثة ليظهر لك المحتوى المناسب."
          >
            <form
              className="student-settings-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setSaved(false);
                const form = new FormData(event.currentTarget);
                const response = await fetch('/api/profile', {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(Object.fromEntries(form)),
                });
                if (response.ok) {
                  setSaved(true);
                  await load();
                }
              }}
            >
              <label>
                <span>الاسم</span>
                <input
                  name="name"
                  defaultValue={data.user.profile?.name || data.user.displayName}
                  required
                />
              </label>
              <label>
                <span>البريد الإلكتروني</span>
                <input value={data.user.email} disabled />
              </label>
              <label>
                <span>رقم الموبايل</span>
                <input
                  name="phone"
                  defaultValue={data.user.profile?.phone || ''}
                  inputMode="tel"
                  placeholder="01xxxxxxxxx"
                />
              </label>
              <label>
                <span>الصف الدراسي</span>
                <select name="grade" defaultValue={data.user.profile?.grade || ''}>
                  <option value="">اختر الصف</option>
                  <option>أولى ثانوي</option>
                  <option>تانية ثانوي</option>
                  <option>تالتة ثانوي</option>
                </select>
              </label>
              <div className="settings-submit">
                <button className="btn btn-primary" type="submit">
                  حفظ التغييرات
                </button>
                {saved && (
                  <span className="inline-success">
                    <CheckCircle2 /> تم حفظ البيانات
                  </span>
                )}
              </div>
            </form>
          </ListPage>
        )}
        {view === 'security' && (
          <ListPage
            icon={<ShieldCheck />}
            eyebrow="الحماية والخصوصية"
            title="الأمان وكلمة السر"
            description="حدّث كلمة السر وتحكم في أمان حسابك."
          >
            <div className="security-grid">
              <section className="settings-card">
                <div className="settings-card-heading">
                  <KeyRound />
                  <div>
                    <h3>تغيير كلمة السر</h3>
                    <p>استخدم كلمة سر قوية لا تستخدمها في مكان آخر.</p>
                  </div>
                </div>
                <form
                  className="security-form"
                  onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    setPasswordMsg('');
                    setPasswordErr('');
                    const form = new FormData(event.currentTarget);
                    const response = await fetch('/api/auth/change-password', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(Object.fromEntries(form)),
                    });
                    const result = (await response.json().catch(() => ({}))) as { error?: string };
                    if (response.ok) {
                      setPasswordMsg('تم تغيير كلمة السر بنجاح');
                      event.currentTarget.reset();
                    } else setPasswordErr(result.error || 'تعذّر تغيير كلمة السر');
                  }}
                >
                  <label>
                    <span>كلمة السر الحالية</span>
                    <input
                      name="currentPassword"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <label>
                    <span>كلمة السر الجديدة (8 أحرف على الأقل)</span>
                    <input
                      name="newPassword"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    <span>تأكيد كلمة السر الجديدة</span>
                    <input
                      name="newPasswordConfirm"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="btn btn-primary" type="submit">
                    تحديث كلمة السر
                  </button>
                  {passwordMsg && (
                    <span className="inline-success">
                      <CheckCircle2 /> {passwordMsg}
                    </span>
                  )}
                  {passwordErr && <span className="inline-error">{passwordErr}</span>}
                </form>
              </section>
              <aside className="security-status">
                <LockKeyhole />
                <h3>حسابك محمي</h3>
                <p>بريدك الإلكتروني مؤكد. لا تشارك كلمة السر أو كود التحقق مع أي شخص.</p>
                <div>
                  <CheckCircle2 /> البريد الإلكتروني مؤكد
                </div>
                <div>
                  <CheckCircle2 /> جلسة دخول آمنة
                </div>
              </aside>
            </div>
            <section className="danger-zone">
              <div>
                <AlertTriangle />
                <span>
                  <strong>حذف الحساب</strong>
                  <small>هذا الإجراء نهائي ويمسح بياناتك الشخصية.</small>
                </span>
              </div>
              <button onClick={() => setDeleteModal(true)}>حذف حسابي</button>
            </section>
          </ListPage>
        )}
      </main>
      {deleteModal && (
        <div className="student-modal" dir="rtl">
          <div className="student-modal-card">
            <button
              className="modal-close"
              onClick={() => setDeleteModal(false)}
              aria-label="إغلاق"
            >
              <X />
            </button>
            <AlertTriangle className="modal-warning" />
            <h3>تأكيد حذف الحساب</h3>
            <p>هذا الإجراء لا يمكن التراجع عنه. اكتب بريدك وكلمة السر للتأكيد.</p>
            {deleteErr && <div className="inline-error">{deleteErr}</div>}
            <label>
              <span>البريد الإلكتروني</span>
              <input
                type="email"
                value={deleteEmail}
                onChange={(event) => setDeleteEmail(event.target.value)}
                placeholder={data.user.email}
              />
            </label>
            <label>
              <span>كلمة السر</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteModal(false)}>
                إلغاء
              </button>
              <button
                className="btn danger-button"
                disabled={deleteBusy || deleteEmail !== data.user.email}
                onClick={async () => {
                  setDeleteErr('');
                  setDeleteBusy(true);
                  try {
                    const response = await fetch('/api/users/me', {
                      method: 'DELETE',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ password: deletePassword }),
                    });
                    const result = (await response.json().catch(() => ({}))) as { error?: string };
                    if (!response.ok) return setDeleteErr(result.error || 'تعذّر حذف الحساب');
                    window.location.assign('/login?deleted=1');
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? 'جاري الحذف...' : 'نعم، احذف حسابي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExamRow({
  exam,
  detailed = false,
}: {
  exam: DashboardData['exams'][number];
  detailed?: boolean;
}) {
  const passed = Number(exam.bestPercentage) >= Number(exam.passingScore);
  const attemptsLeft = Math.max(0, Number(exam.maxAttempts || 3) - Number(exam.attemptCount || 0));
  return (
    <article className={`exam-row ${detailed ? 'detailed' : ''}`}>
      <span className="exam-date">
        <b>{exam.durationMinutes}</b>
        <small>دقيقة</small>
      </span>
      <div className="exam-copy">
        <strong>{exam.title}</strong>
        {!exam.isRead && <span className="status-pill status-pending">جديد</span>}
        <small>
          {exam.courseTitle || 'امتحان عام'} · {attemptsLeft} محاولات متبقية
        </small>
        {detailed && exam.description && <p>{exam.description}</p>}
      </div>
      {passed ? (
        <span className="status-pill status-approved">
          <CheckCircle2 /> تم الاجتياز
        </span>
      ) : attemptsLeft > 0 ? (
        <Link href={`/exam/${exam.id}`} className="exam-action">
          {exam.attemptCount ? 'إعادة المحاولة' : 'ابدأ الامتحان'} <ArrowLeft />
        </Link>
      ) : (
        <span className="status-pill status-rejected">انتهت المحاولات</span>
      )}
    </article>
  );
}
function ListPage({
  icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="student-view">
      <header className="student-page-heading">
        <div className="page-heading-icon">{icon}</div>
        <div>
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <section className="student-card page-content-card">{children}</section>
    </div>
  );
}
function EmptyPanel({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="student-empty compact">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
