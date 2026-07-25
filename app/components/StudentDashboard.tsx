"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, BookOpen, CheckCircle2, Clock3, GraduationCap,
  LoaderCircle, Megaphone, PlayCircle, Settings,
} from "lucide-react";
import EmailVerification from "./EmailVerification";

type DashboardData = {
  verificationRequired: boolean;
  user: {
    email: string;
    displayName: string;
    profile?: { name?: string; phone?: string; grade?: string } | null;
  };
  enrollments: Array<{ id: string; courseId: string; title: string; grade: string; status: string }>;
  exams: Array<{ id: string; title: string; description: string; durationMinutes: number; courseTitle?: string; maxScore: number; passingScore: number; maxAttempts: number; attemptCount: number; bestPercentage: number }>;
  attempts: Array<{ id: string; examId: string; title: string; score: number; maxScore: number; feedback: string; submittedAt: number }>;
  announcements: Array<{ id: string; title: string; body: string; createdAt: number }>;
};

const statusLabel: Record<string, string> = {
  approved: "مفعّل",
  pending: "تحت المراجعة",
  rejected: "مرفوض",
};

export default function StudentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordErr, setPasswordErr] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as DashboardData & { error?: string };
    if (!response.ok) return setError(result.error || "تعذر تحميل حسابك");
    setData(result);
  }, []);

  useEffect(() => {
    // Initial remote dashboard synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <div className="dashboard-state error-toast">{error}</div>;
  if (!data) return <div className="dashboard-state"><LoaderCircle className="spin" /> جاري تحميل بياناتك...</div>;

  if (data.verificationRequired) {
    return (
      <div className="dashboard-shell">
        <header className="dashboard-welcome">
          <div><span className="section-label">مساحتي التعليمية</span><h1>أهلًا، {data.user.displayName}</h1><p>خطوة واحدة قبل فتح الكورسات والامتحانات.</p></div>
          <a href="/student/logout" className="btn btn-outline">تسجيل الخروج</a>
        </header>
        <EmailVerification email={data.user.email} onVerified={load} />
      </div>
    );
  }

  const approved = data.enrollments.filter((item) => item.status === "approved");
  const gradedAttempts = data.attempts.filter((item) => item.maxScore > 0);
  const average = gradedAttempts.length
    ? Math.round(gradedAttempts.reduce((sum, item) => sum + (item.score * 100 / item.maxScore), 0) / gradedAttempts.length)
    : 0;

  return (
    <div className="dashboard-shell">
      <header className="dashboard-welcome">
        <div><span className="section-label">مساحتي التعليمية</span><h1>أهلاً، {data.user.profile?.name || data.user.displayName}</h1><p>كل كورساتك وامتحاناتك ونتائجك محفوظة هنا.</p></div>
        <div className="dashboard-actions">
          <a href="/student/logout" className="btn btn-outline">تسجيل الخروج</a>
        </div>
      </header>

      <section className="stats-grid">
        <article><BookOpen /><span>الكورسات المفعّلة</span><strong>{approved.length}</strong></article>
        <article><GraduationCap /><span>الامتحانات المتاحة</span><strong>{data.exams.length}</strong></article>
        <article><BarChart3 /><span>متوسط النتائج</span><strong>{average}%</strong></article>
        <article><Clock3 /><span>طلبات قيد المراجعة</span><strong>{data.enrollments.filter((item) => item.status === "pending").length}</strong></article>
      </section>

      {data.announcements.length > 0 && (
        <section className="dashboard-panel">
          <div className="panel-title"><Megaphone /><div><h2>إعلانات مهمة</h2><p>آخر الأخبار من مستر أحمد حسن</p></div></div>
          <div className="announcement-list">
            {data.announcements.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>)}
          </div>
        </section>
      )}

      <div className="dashboard-columns">
        <section className="dashboard-panel">
          <div className="panel-title"><BookOpen /><div><h2>كورساتي</h2><p>تابع حالة اشتراكك وافتح المحتوى</p></div></div>
          <div className="dashboard-list">
            {data.enrollments.length ? data.enrollments.map((item) => (
              <article key={item.id}>
                <div><strong>{item.title}</strong><small>{item.grade}</small></div>
                <div className="list-actions">
                  <span className={`status-pill status-${item.status}`}>{statusLabel[item.status] || item.status}</span>
                  {item.status === "approved" && <Link href={`/learn/${item.courseId}`} className="icon-link" aria-label="فتح الكورس"><PlayCircle /></Link>}
                </div>
              </article>
            )) : <div className="empty-state">لسه ما اشتركتش في كورس. <Link href="/courses">شوف الكورسات</Link></div>}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-title"><GraduationCap /><div><h2>الامتحانات</h2><p>امتحانات كورساتك المتاحة الآن</p></div></div>
          <div className="dashboard-list">
            {data.exams.length ? data.exams.map((exam) => {
              const passed = Number(exam.bestPercentage) >= Number(exam.passingScore);
              const attemptsLeft = Math.max(0, Number(exam.maxAttempts || 3) - Number(exam.attemptCount || 0));
              return (
                <article key={exam.id}>
                  <div><strong>{exam.title}</strong><small>{exam.courseTitle || "امتحان عام"} · {exam.durationMinutes} دقيقة</small></div>
                  {passed
                    ? <span className="status-pill status-approved"><CheckCircle2 /> تم الاجتياز</span>
                    : attemptsLeft > 0
                      ? <Link href={`/exam/${exam.id}`} className="btn btn-primary btn-small">{exam.attemptCount ? "أعد المحاولة" : "ابدأ"} <ArrowLeft /></Link>
                      : <span className="status-pill status-rejected">انتهت المحاولات</span>}
                </article>
              );
            }) : <div className="empty-state">لا توجد امتحانات متاحة حالياً.</div>}
          </div>
        </section>
      </div>

      <section className="dashboard-panel">
        <div className="panel-title"><BarChart3 /><div><h2>آخر النتائج</h2><p>تفاصيل الدرجات وملاحظات التصحيح</p></div></div>
        <div className="results-table-wrap"><table className="data-table">
          <thead><tr><th>الامتحان</th><th>الدرجة</th><th>النسبة</th><th>الملاحظات</th><th>التفاصيل</th></tr></thead>
          <tbody>{data.attempts.length ? data.attempts.map((attempt) => (
            <tr key={attempt.id}>
              <td>{attempt.title}</td>
              <td>{attempt.score} / {attempt.maxScore}</td>
              <td>{attempt.maxScore ? Math.round(attempt.score * 100 / attempt.maxScore) : 0}%</td>
              <td>{attempt.feedback}</td>
              <td><Link href={`/result/${attempt.id}`} className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}>مشاهدة</Link></td>
            </tr>
          )) : <tr><td colSpan={5}>لم تسلّم أي امتحان بعد.</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="dashboard-panel">
        <div className="panel-title"><Settings /><div><h2>بيانات الطالب</h2><p>كمّل بياناتك علشان نرشح لك المحتوى المناسب</p></div></div>
        <form className="profile-form" onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const form = new FormData(event.currentTarget);
          const response = await fetch("/api/profile", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(Object.fromEntries(form)),
          });
          if (response.ok) { setSaved(true); await load(); }
        }}>
          <label>الاسم<input name="name" defaultValue={data.user.profile?.name || data.user.displayName} required /></label>
          <label>رقم الموبايل<input name="phone" defaultValue={data.user.profile?.phone || ""} inputMode="tel" /></label>
          <label>الصف<select name="grade" defaultValue={data.user.profile?.grade || ""}><option value="">اختر الصف</option><option>أولى ثانوي</option><option>تانية ثانوي</option><option>تالتة ثانوي</option></select></label>
          <button className="btn btn-primary" type="submit">حفظ البيانات</button>
          {saved && <span className="inline-success"><CheckCircle2 /> تم الحفظ</span>}
        </form>

        <hr style={{ margin: "1.5rem 0", opacity: 0.2 }} />
        <div className="panel-title" style={{ marginBottom: "0.75rem" }}><div><h3 style={{ margin: 0 }}>تغيير كلمة السر</h3><p>أدخل كلمتك الحالية ثم اختر كلمة جديدة</p></div></div>
        <form className="profile-form" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setPasswordMsg(""); setPasswordErr("");
          const form = new FormData(event.currentTarget);
          const body = Object.fromEntries(form);
          const response = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
          if (response.ok) {
            setPasswordMsg("تم تغيير كلمة السر بنجاح");
            (event.target as HTMLFormElement).reset();
          } else {
            setPasswordErr(result.error || "تعذّر تغيير كلمة السر");
          }
        }}>
          <label>كلمة السر الحالية<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label>كلمة السر الجديدة (8 أحرف على الأقل)<input name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>تأكيد كلمة السر الجديدة<input name="newPasswordConfirm" type="password" required minLength={8} autoComplete="new-password" /></label>
          <button className="btn btn-primary" type="submit">تغيير كلمة السر</button>
          {passwordMsg && <span className="inline-success"><CheckCircle2 /> {passwordMsg}</span>}
          {passwordErr && <span style={{ color: "var(--error, #e74c3c)", fontSize: "0.9rem" }}>{passwordErr}</span>}
        </form>
      </section>
    </div>
  );
}
