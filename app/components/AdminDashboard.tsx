"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  BarChart3, BellRing, BookOpen, Check, CirclePlus, ClipboardCheck, FileQuestion,
  GraduationCap, LayoutDashboard, LoaderCircle, LogOut, Mail, PencilLine, PlaySquare,
  RefreshCw, Save, ShieldCheck, Trash2, Upload, UserCog, Users, X,
} from "lucide-react";

type Course = { id: string; title: string; grade: string; description: string; price: number; status: string };
type Exam = { id: string; courseId?: string; title: string; description?: string; instructions?: string; courseTitle?: string; durationMinutes: number; passingScore: number; maxAttempts: number; status: string; questionCount: number; maxScore: number };
type Enrollment = { id: string; userEmail: string; courseId: string; courseTitle: string; status: string; paymentMethod?: string; paymentReference?: string; createdAt: number };
type Attempt = { id: string; userEmail: string; examTitle: string; score: number; maxScore: number; gradingMethod: string; submittedAt: number };
type Video = { id: string; courseId: string; title: string; courseTitle: string; status: string; durationSeconds: number; prerequisiteExamId?: string; prerequisiteExamTitle?: string; minimumScore: number };
type Contact = { id: string; name: string; phone: string; message: string; status: string; createdAt: number };
type Student = { email: string; name: string; firstName?: string; lastName?: string; phone: string; fatherPhone: string; motherPhone: string; schoolName: string; governorate: string; gender: string; grade: string; section: string; createdAt: number; activeEnrollments: number; totalAttempts: number };
type Permission = "manage_courses" | "manage_exams" | "manage_videos" | "manage_enrollments" | "grade_exams" | "manage_announcements" | "manage_messages" | "view_students" | "manage_staff";
type StaffAccount = { email: string; name: string; role: string; permissions: string; active: number; lockedUntil?: number };
type AdminData = {
  admin: { email: string; name: string; role: string; permissions: Permission[] };
  counts: { students: number; activeEnrollments: number; pendingEnrollments: number; publishedExams: number; attempts: number; averageScore: number };
  courses: Course[]; exams: Exam[]; enrollments: Enrollment[]; attempts: Attempt[]; videos: Video[]; contacts: Contact[];
};
type Tab = "overview" | "courses" | "exams" | "videos" | "students" | "enrollments" | "results" | "messages" | "staff";
type QuestionDraft = { type: string; prompt: string; options: string; correctAnswer: string; rubric: string; points: number };

const emptyQuestion = (): QuestionDraft => ({ type: "multiple_choice", prompt: "", options: "", correctAnswer: "", rubric: "", points: 1 });

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard; permission?: Permission }> = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "courses", label: "الكورسات", icon: BookOpen, permission: "manage_courses" },
  { id: "exams", label: "الامتحانات", icon: FileQuestion, permission: "manage_exams" },
  { id: "videos", label: "المحاضرات", icon: PlaySquare, permission: "manage_videos" },
  { id: "students", label: "الطلاب", icon: GraduationCap, permission: "view_students" },
  { id: "enrollments", label: "الاشتراكات", icon: Users, permission: "manage_enrollments" },
  { id: "results", label: "النتائج والتصحيح", icon: BarChart3, permission: "grade_exams" },
  { id: "messages", label: "الرسائل", icon: Mail, permission: "manage_messages" },
  { id: "staff", label: "حسابات الفريق", icon: UserCog, permission: "manage_staff" },
];

async function apiRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const result = await response.json().catch(() => ({})) as { error?: string; [key: string]: unknown };
  if (response.status === 401 && path.startsWith("/api/admin/")) {
    window.location.assign("/staff/login");
  }
  if (!response.ok) throw new Error(result.error || "تعذر تنفيذ العملية");
  return result;
}

export default function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [uploadProgress, setUploadProgress] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await apiRequest("/api/admin/bootstrap", { cache: "no-store" }) as unknown as AdminData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل لوحة الإدارة");
    }
  }, []);

  useEffect(() => {
    // Initial remote dashboard synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await load(); }
    catch (mutationError) { setError(mutationError instanceof Error ? mutationError.message : "تعذر تنفيذ العملية"); }
    finally { setBusy(false); }
  };

  if (!data && !error) return <div className="dashboard-state"><LoaderCircle className="spin" /> جاري تحميل لوحة الإدارة...</div>;
  if (!data) return <div className="dashboard-state error-toast">{error}</div>;
  const can = (permission: Permission) => data.admin.permissions.includes(permission);
  const availableTabs = tabs.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand"><ShieldCheck /><div><strong>{data.admin.name}</strong><small>{data.admin.role === "teacher" ? "مدرس — صلاحية كاملة" : "مساعد"} · {data.admin.email}</small></div></div>
        <nav>{availableTabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? "active" : ""}><Icon /> {label}{id === "students" && data.counts.pendingEnrollments > 0 && <b>{data.counts.pendingEnrollments}</b>}</button>
        ))}</nav>
        <div className="admin-sidebar-footer"><span>بوابة الفريق الخاصة</span><button onClick={async () => { await fetch("/api/staff/logout", { method: "POST" }); window.location.assign("/staff/login"); }}><LogOut /> تسجيل الخروج</button></div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar"><div><span className="section-label">لوحة الفريق الخاصة</span><h1>{availableTabs.find((item) => item.id === tab)?.label || "نظرة عامة"}</h1></div><button className="btn btn-ghost" onClick={() => void load()}><RefreshCw /> تحديث</button></header>
        {notice && <div className="success-toast"><Check /> {notice}</div>}
        {error && <div className="error-toast"><X /> {error}</div>}

        {tab === "overview" && (
          <>
            <section className="stats-grid admin-stats">
              <article><Users /><span>الطلاب</span><strong>{data.counts.students}</strong></article>
              <article><GraduationCap /><span>اشتراكات مفعّلة</span><strong>{data.counts.activeEnrollments}</strong></article>
              <article><ClipboardCheck /><span>طلبات معلّقة</span><strong>{data.counts.pendingEnrollments}</strong></article>
              <article><FileQuestion /><span>امتحانات منشورة</span><strong>{data.counts.publishedExams}</strong></article>
              <article><BarChart3 /><span>متوسط النتائج</span><strong>{Math.round(Number(data.counts.averageScore) || 0)}%</strong></article>
            </section>
            <div className="admin-overview-grid">
              {can("manage_announcements") && <section className="dashboard-panel">
                <div className="panel-title"><BellRing /><div><h2>نشر إعلان</h2><p>يظهر فوراً في لوحة كل الطلاب</p></div></div>
                <form className="stack-form" onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = Object.fromEntries(new FormData(form));
                  void mutate(() => apiRequest("/api/admin/announcements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }), "تم نشر الإعلان").then(() => form.reset());
                }}>
                  <label>العنوان<input name="title" required maxLength={150} /></label>
                  <label>الإعلان<textarea name="body" rows={4} required maxLength={2000} /></label>
                  <button className="btn btn-primary" disabled={busy}><BellRing /> نشر الإعلان</button>
                </form>
              </section>}
              <section className="dashboard-panel">
                <div className="panel-title"><ClipboardCheck /><div><h2>بحاجة لمراجعتك</h2><p>أهم الإجراءات المعلقة</p></div></div>
                <div className="attention-list">
                  {can("manage_enrollments") && <button onClick={() => setTab("enrollments")}><strong>{data.counts.pendingEnrollments}</strong><span>طلب اشتراك جديد</span></button>}
                  {can("manage_messages") && <button onClick={() => setTab("messages")}><strong>{data.contacts.filter((item) => item.status === "new").length}</strong><span>رسالة جديدة</span></button>}
                  {can("grade_exams") && <button onClick={() => setTab("results")}><strong>{data.attempts.filter((item) => item.gradingMethod !== "teacher_review").length}</strong><span>نتيجة تحتاج مراجعة</span></button>}
                </div>
              </section>
            </div>
          </>
        )}

        {tab === "courses" && (
          <div className="admin-split">
            <section className="dashboard-panel">
              <div className="panel-title"><CirclePlus /><div><h2>إضافة كورس</h2><p>أنشئ كورساً واربط به الفيديوهات والامتحانات</p></div></div>
              <form className="stack-form" onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = Object.fromEntries(new FormData(form));
                void mutate(() => apiRequest("/api/admin/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }), "تمت إضافة الكورس").then(() => form.reset());
              }}>
                <label>اسم الكورس<input name="title" required /></label>
                <label>الصف<select name="grade" required><option value="">اختر الصف</option><option>أولى ثانوي</option><option>تانية ثانوي</option><option>تالتة ثانوي</option><option>كل الصفوف</option></select></label>
                <label>الوصف<textarea name="description" rows={4} /></label>
                <div className="form-row"><label>السعر<input name="price" type="number" min="0" defaultValue="0" /></label><label>الحالة<select name="status"><option value="draft">مسودة</option><option value="published">منشور</option></select></label></div>
                <button className="btn btn-primary" disabled={busy}><Save /> حفظ الكورس</button>
              </form>
            </section>
            <section className="dashboard-panel wide-panel">
              <div className="panel-title"><BookOpen /><div><h2>كل الكورسات</h2><p>{data.courses.length} كورس</p></div></div>
              <div className="management-list">{data.courses.map((course) => (
                <article key={course.id}><div><strong>{course.title}</strong><small>{course.grade} · {course.price} جنيه</small><p>{course.description}</p></div><div className="list-actions"><span className={`status-pill status-${course.status === "published" ? "approved" : "pending"}`}>{course.status === "published" ? "منشور" : "مسودة"}</span><button className="icon-button danger" aria-label="حذف" onClick={() => void mutate(() => apiRequest(`/api/admin/courses/${course.id}`, { method: "DELETE" }), "تم حذف الكورس")}><Trash2 /></button></div></article>
              ))}</div>
            </section>
          </div>
        )}

        {tab === "exams" && (
          <div className="exam-admin-grid">
            <ExamBuilder courses={data.courses} questions={questions} setQuestions={setQuestions} busy={busy} onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = Object.fromEntries(new FormData(form));
              const prepared = questions.map((question) => ({
                ...question,
                options: question.type === "true_false" ? ["صح", "خطأ"] : question.options.split("\n").map((option) => option.trim()).filter(Boolean),
              }));
              void mutate(() => apiRequest("/api/admin/exams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, questions: prepared }) }), "تم حفظ الامتحان").then(() => { form.reset(); setQuestions([emptyQuestion()]); });
            }} />
            <section className="dashboard-panel">
              <div className="panel-title"><FileQuestion /><div><h2>الامتحانات المحفوظة</h2><p>{data.exams.length} امتحان</p></div></div>
              <div className="management-list compact">{data.exams.map((exam) => (
                <article key={exam.id}><div><strong>{exam.title}</strong><small>{exam.courseTitle || "امتحان عام"} · {exam.questionCount} سؤال · {exam.maxScore} درجة</small></div><div className="list-actions"><button className="status-button" onClick={() => void mutate(() => apiRequest(`/api/admin/exams/${exam.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...exam, status: exam.status === "published" ? "draft" : "published" }) }), "تم تحديث حالة الامتحان")}>{exam.status === "published" ? "إلغاء النشر" : "نشر"}</button><button className="icon-button danger" onClick={() => void mutate(() => apiRequest(`/api/admin/exams/${exam.id}`, { method: "DELETE" }), "تم حذف الامتحان")}><Trash2 /></button></div></article>
              ))}</div>
            </section>
          </div>
        )}

        {tab === "videos" && (
          <div className="admin-split">
            <section className="dashboard-panel">
              <div className="panel-title"><Upload /><div><h2>رفع فيديو آمن</h2><p>الفيديو يُحفظ في مساحة خاصة ولا يظهر إلا للمشتركين</p></div></div>
              <VideoUploader courses={data.courses} exams={data.exams} busy={busy} progress={uploadProgress} onProgress={setUploadProgress} onDone={async () => { setNotice("تم رفع المحاضرة وتأمينها"); await load(); }} onError={setError} />
            </section>
            <section className="dashboard-panel wide-panel">
              <div className="panel-title"><PlaySquare /><div><h2>مكتبة الفيديو</h2><p>{data.videos.length} فيديو محمي</p></div></div>
              <div className="management-list compact">{data.videos.map((video) => (
                <article key={video.id}><div><strong>{video.title}</strong><small>{video.courseTitle}{video.prerequisiteExamTitle ? ` · يفتح بعد: ${video.prerequisiteExamTitle}${video.minimumScore ? ` (${video.minimumScore}%)` : ""}` : " · بدون اختبار سابق"}</small></div><div className="list-actions"><button className="status-button" onClick={() => {
                  const newTitle = window.prompt("عنوان الفيديو الجديد", video.title);
                  if (!newTitle || newTitle.trim().length < 2) return;
                  void mutate(() => apiRequest(`/api/admin/videos/${video.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newTitle.trim(), prerequisiteExamId: video.prerequisiteExamId ?? "", minimumScore: video.minimumScore, status: video.status }) }), "تم تعديل عنوان الفيديو");
                }}><PencilLine /> تعديل</button><button className="icon-button danger" onClick={() => void mutate(() => apiRequest(`/api/admin/videos/${video.id}`, { method: "DELETE" }), "تم حذف الفيديو")}><Trash2 /></button></div></article>
              ))}</div>
            </section>
          </div>
        )}

        {tab === "students" && can("view_students") && <StudentsPanel />}

        {tab === "enrollments" && (
          <section className="dashboard-panel">
            <div className="panel-title"><Users /><div><h2>طلبات الاشتراك</h2><p>راجع الرقم المرجعي ثم فعّل أو ارفض الطلب</p></div></div>
            <div className="results-table-wrap"><table className="data-table"><thead><tr><th>الطالب</th><th>الكورس</th><th>الدفع</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
              {data.enrollments.map((item) => <tr key={item.id}><td>{item.userEmail}</td><td>{item.courseTitle}</td><td>{item.paymentMethod || "—"}<small className="table-note">{item.paymentReference || "بدون رقم مرجعي"}</small></td><td><span className={`status-pill status-${item.status}`}>{item.status === "approved" ? "مفعّل" : item.status === "pending" ? "معلّق" : "مرفوض"}</span></td><td><div className="table-actions"><button onClick={() => void mutate(() => apiRequest(`/api/admin/enrollments/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) }), "تم تفعيل الاشتراك")}><Check /> تفعيل</button><button className="danger-text" onClick={() => void mutate(() => apiRequest(`/api/admin/enrollments/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "rejected" }) }), "تم رفض الطلب")}><X /> رفض</button></div></td></tr>)}
            </tbody></table></div>
          </section>
        )}

        {tab === "results" && (
          <section className="dashboard-panel">
            <div className="panel-title"><BarChart3 /><div><h2>نتائج الطلاب</h2><p>التصحيح الآلي قابل للمراجعة والتعديل من المدرس</p></div></div>
            <div className="results-table-wrap"><table className="data-table"><thead><tr><th>الطالب</th><th>الامتحان</th><th>الدرجة</th><th>طريقة التصحيح</th><th>مراجعة</th></tr></thead><tbody>
              {data.attempts.map((attempt) => <tr key={attempt.id}><td>{attempt.userEmail}</td><td>{attempt.examTitle}</td><td>{attempt.score} / {attempt.maxScore}</td><td>{attempt.gradingMethod === "ai" ? "ذكاء اصطناعي" : attempt.gradingMethod === "teacher_review" ? "مراجعة المدرس" : "قواعد تلقائية"}</td><td><button className="table-edit" onClick={() => {
                const score = window.prompt(`الدرجة الجديدة من ${attempt.maxScore}`, String(attempt.score));
                if (score === null) return;
                const feedback = window.prompt("ملاحظة المدرس", "") ?? "";
                void mutate(() => apiRequest(`/api/admin/attempts/${attempt.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ score, feedback }) }), "تم حفظ مراجعة المدرس");
              }}><PencilLine /> تعديل</button></td></tr>)}
            </tbody></table></div>
          </section>
        )}

        {tab === "messages" && (
          <section className="dashboard-panel">
            <div className="panel-title"><Mail /><div><h2>رسائل التواصل</h2><p>رسائل الطلاب وأولياء الأمور</p></div></div>
            <div className="message-grid">{data.contacts.map((message) => <article key={message.id} className={message.status === "new" ? "message-new" : ""}><div><strong>{message.name}</strong><a href={`tel:${message.phone}`}>{message.phone}</a><span className={`status-pill status-${message.status === "new" ? "pending" : "approved"}`}>{message.status === "new" ? "جديد" : "تمت المراجعة"}</span></div><p>{message.message}</p><div className="message-footer"><time>{new Date(message.createdAt).toLocaleDateString("ar-EG")}</time>{message.status === "new" && <button className="status-button" onClick={() => void mutate(() => apiRequest(`/api/admin/contacts/${message.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "reviewed" }) }), "تمت مراجعة الرسالة")}>تحديد كـ"تمت المراجعة"</button>}</div></article>)}</div>
          </section>
        )}
        {tab === "staff" && can("manage_staff") && <StaffManager actorEmail={data.admin.email} />}
      </div>
    </div>
  );
}

function ExamBuilder({ courses, questions, setQuestions, busy, onSubmit }: {
  courses: Course[]; questions: QuestionDraft[]; setQuestions: (value: QuestionDraft[]) => void; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const update = (index: number, patch: Partial<QuestionDraft>) => setQuestions(questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  return (
    <section className="dashboard-panel exam-builder">
      <div className="panel-title"><CirclePlus /><div><h2>إضافة امتحان جديد</h2><p>يدعم الاختيار، صح وخطأ، والإجابات المقالية المصححة بالذكاء الاصطناعي</p></div></div>
      <form className="stack-form" onSubmit={onSubmit}>
        <div className="form-row"><label>اسم الامتحان<input name="title" required /></label><label>الكورس<select name="courseId"><option value="">امتحان عام</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title} — {course.grade}</option>)}</select></label></div>
        <label>الوصف<textarea name="description" rows={2} /></label>
        <label>تعليمات الطالب<textarea name="instructions" rows={2} placeholder="اقرأ كل سؤال جيداً..." /></label>
        <div className="form-row three"><label>المدة بالدقائق<input name="durationMinutes" type="number" min="1" max="300" defaultValue="30" /></label><label>نسبة النجاح %<input name="passingScore" type="number" min="0" max="100" defaultValue="50" /></label><label>عدد المحاولات<input name="maxAttempts" type="number" min="1" max="10" defaultValue="3" /></label></div>
        <label>الحالة<select name="status"><option value="draft">مسودة</option><option value="published">منشور</option></select></label>
        <div className="question-editor-list">
          {questions.map((question, index) => <article className="question-editor" key={index}>
            <header><strong>السؤال {index + 1}</strong>{questions.length > 1 && <button type="button" onClick={() => setQuestions(questions.filter((_, questionIndex) => questionIndex !== index))}><Trash2 /></button>}</header>
            <div className="form-row"><label>نوع السؤال<select value={question.type} onChange={(event) => update(index, { type: event.target.value })}><option value="multiple_choice">اختيار من متعدد</option><option value="true_false">صح أو خطأ</option><option value="short_answer">إجابة قصيرة / مقالية</option></select></label><label>الدرجة<input type="number" min="1" max="100" value={question.points} onChange={(event) => update(index, { points: Number(event.target.value) })} /></label></div>
            <label>نص السؤال<textarea required rows={2} value={question.prompt} onChange={(event) => update(index, { prompt: event.target.value })} /></label>
            {question.type === "multiple_choice" && <label>الاختيارات — كل اختيار في سطر<textarea required rows={4} value={question.options} onChange={(event) => update(index, { options: event.target.value })} placeholder={"الإجابة الأولى\nالإجابة الثانية\nالإجابة الثالثة"} /></label>}
            <label>الإجابة الصحيحة<textarea required rows={2} value={question.correctAnswer} onChange={(event) => update(index, { correctAnswer: event.target.value })} placeholder={question.type === "true_false" ? "صح أو خطأ" : "اكتب الإجابة النموذجية"} /></label>
            {question.type === "short_answer" && <label>معايير التصحيح<textarea rows={3} value={question.rubric} onChange={(event) => update(index, { rubric: event.target.value })} placeholder="النقاط الأساسية التي يجب أن تتضمنها الإجابة..." /></label>}
          </article>)}
        </div>
        <button type="button" className="btn btn-ghost add-question" onClick={() => setQuestions([...questions, emptyQuestion()])}><CirclePlus /> إضافة سؤال</button>
        <button className="btn btn-primary btn-large" disabled={busy}><Save /> حفظ الامتحان</button>
      </form>
    </section>
  );
}

function VideoUploader({ courses, exams, busy, progress, onProgress, onDone, onError }: {
  courses: Course[]; exams: Exam[]; busy: boolean; progress: string; onProgress: (value: string) => void; onDone: () => Promise<void>; onError: (value: string) => void;
}) {
  const [courseId, setCourseId] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("video");
    if (!(file instanceof File)) return;
    onProgress("جاري رفع الفيديو...");
    onError("");
    try {
      await apiRequest("/api/admin/videos", {
        method: "POST",
        headers: {
          "content-type": file.type,
          "x-course-id": String(values.get("courseId") || ""),
          "x-video-title": encodeURIComponent(String(values.get("title") || "")),
          "x-video-duration": String(values.get("durationSeconds") || "0"),
          "x-prerequisite-exam-id": String(values.get("prerequisiteExamId") || ""),
          "x-minimum-score": String(values.get("minimumScore") || "0"),
        },
        body: file,
      });
      onProgress("");
      form.reset();
      setCourseId("");
      await onDone();
    } catch (uploadError) {
      onProgress("");
      onError(uploadError instanceof Error ? uploadError.message : "تعذر رفع الفيديو");
    }
  };
  return (
    <form className="stack-form" onSubmit={submit}>
      <label>الكورس<select name="courseId" required value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">اختر الكورس</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title} — {course.grade}</option>)}</select></label>
      <label>عنوان الفيديو<input name="title" required /></label>
      <div className="form-row"><label>المدة بالثواني<input name="durationSeconds" type="number" min="0" defaultValue="0" /></label><label>اختبار قبل المحاضرة<select name="prerequisiteExamId"><option value="">بدون اختبار</option>{exams.filter((exam) => exam.courseId === courseId && exam.status === "published").map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label></div>
      <label>أقل نسبة لفتح المحاضرة %<input name="minimumScore" type="number" min="0" max="100" defaultValue="0" /><small>اكتب 0 إذا كان المطلوب إكمال الاختبار فقط.</small></label>
      <label className="file-drop"><Upload /><strong>اختر ملف MP4 أو WebM</strong><small>يُحفظ في مساحة خاصة ويُبث للمشتركين فقط</small><input name="video" type="file" accept="video/mp4,video/webm" required /></label>
      <button className="btn btn-primary" disabled={busy || Boolean(progress)}><Upload /> {progress || "رفع وتأمين الفيديو"}</button>
    </form>
  );
}

function StaffManager({ actorEmail }: { actorEmail: string }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStaff = useCallback(async () => {
    try {
      const result = await apiRequest("/api/admin/staff", { cache: "no-store" }) as { staff: StaffAccount[] };
      setStaff(result.staff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل حسابات الفريق");
    }
  }, []);

  useEffect(() => {
    // Initial team-account synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStaff();
  }, [loadStaff]);

  const update = async (email: string, body: Record<string, unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/api/admin/staff/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setNotice(success);
      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "تعذر تحديث الحساب");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-split">
      <section className="dashboard-panel">
        <div className="panel-title"><UserCog /><div><h2>إنشاء حساب فريق</h2><p>لا يمكن لأي شخص التسجيل كمدرس أو مساعد. الحسابات تُنشأ من هنا فقط.</p></div></div>
        <form className="stack-form" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true); setError(""); setNotice("");
          const form = event.currentTarget;
          try {
            await apiRequest("/api/admin/staff", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(Object.fromEntries(new FormData(form))),
            });
            setNotice("تم إنشاء حساب الفريق");
            form.reset();
            await loadStaff();
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : "تعذر إنشاء الحساب");
          } finally {
            setBusy(false);
          }
        }}>
          <label>الاسم<input name="name" required minLength={2} /></label>
          <label>البريد الخاص بالدخول<input name="email" type="email" required autoComplete="off" /></label>
          <label>كلمة مرور مؤقتة<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
          <label>نوع الحساب<select name="role" defaultValue="assistant"><option value="assistant">مساعد</option><option value="teacher">مدرس — صلاحية كاملة</option></select></label>
          <label>صلاحيات المساعد<select name="preset" defaultValue="grader"><option value="grader">التصحيح والدرجات فقط</option><option value="course_manager">الكورسات والامتحانات والمحاضرات</option><option value="enrollment_manager">الطلاب والاشتراكات</option></select></label>
          <button className="btn btn-primary" disabled={busy}><UserCog /> إنشاء الحساب</button>
        </form>
        {notice && <div className="success-toast"><Check /> {notice}</div>}
        {error && <div className="error-toast"><X /> {error}</div>}
      </section>
      <section className="dashboard-panel wide-panel">
        <div className="panel-title"><ShieldCheck /><div><h2>حسابات المدرسين والمساعدين</h2><p>تعطيل الحساب يوقف دخوله فور انتهاء جلسته؛ تغيير كلمة المرور ينهي كل جلساته.</p></div></div>
        <div className="management-list">{staff.map((account) => {
          let permissions: string[] = [];
          try { permissions = JSON.parse(account.permissions) as string[]; } catch { permissions = []; }
          return <article key={account.email}><div><strong>{account.name}</strong><small>{account.role === "teacher" ? "مدرس — صلاحية كاملة" : permissionLabel(permissions)} · {account.email}</small></div><div className="list-actions">
            <span className={`status-pill status-${account.active ? "approved" : "rejected"}`}>{account.active ? "نشط" : "موقوف"}</span>
            {account.email !== actorEmail && <button className="status-button" disabled={busy} onClick={() => void update(account.email, { active: !account.active, role: account.role, preset: presetFor(permissions) }, account.active ? "تم تعطيل الحساب" : "تم تفعيل الحساب")}>{account.active ? "تعطيل" : "تفعيل"}</button>}
            {account.role === "assistant" && <select className="status-button" value={presetFor(permissions)} disabled={busy} onChange={(event) => void update(account.email, { active: Boolean(account.active), role: "assistant", preset: event.target.value }, "تم تحديث صلاحيات المساعد")}><option value="grader">الدرجات فقط</option><option value="course_manager">الكورسات فقط</option><option value="enrollment_manager">الاشتراكات فقط</option></select>}
            <button className="status-button" disabled={busy} onClick={() => {
              const password = window.prompt("كلمة المرور الجديدة (12 حرفاً على الأقل)");
              if (!password) return;
              void update(account.email, { password, active: Boolean(account.active), role: account.role, preset: presetFor(permissions) }, "تم تغيير كلمة المرور وإنهاء الجلسات القديمة");
            }}>تغيير كلمة المرور</button>
          </div></article>;
        })}</div>
      </section>
    </div>
  );
}

function presetFor(permissions: string[]): string {
  if (permissions.includes("manage_staff")) return "full_access";
  if (permissions.includes("manage_courses")) return "course_manager";
  if (permissions.includes("manage_enrollments")) return "enrollment_manager";
  return "grader";
}

function permissionLabel(permissions: string[]): string {
  const preset = presetFor(permissions);
  if (preset === "course_manager") return "مساعد كورسات وامتحانات";
  if (preset === "enrollment_manager") return "مساعد طلاب واشتراكات";
  return "مساعد تصحيح ودرجات";
}

function StudentsPanel() {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadStudents = useCallback(async (p = 1, q = search, g = grade) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(p), limit: "50" });
      if (q) params.set("q", q);
      if (g) params.set("grade", g);
      const res = await apiRequest(`/api/admin/students?${params.toString()}`, { cache: "no-store" }) as {
        students: Student[]; total: number; pages: number;
      };
      setStudents(res.students);
      setTotal(res.total);
      setPages(res.pages);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الطلاب");
    } finally {
      setLoading(false);
    }
  }, [search, grade]);

  useEffect(() => {
    // Initial students synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStudents(1, "", "");
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void loadStudents(1, search, grade);
  };

  return (
    <section className="dashboard-panel">
      <div className="panel-title"><GraduationCap /><div><h2>قائمة الطلاب</h2><p>{total} طالب مسجّل</p></div></div>
      <form className="student-search-bar" onSubmit={handleSearch} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input placeholder="ابحث بالاسم أو البريد أو الموبايل..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: "200px" }} />
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">كل الصفوف</option>
          <option>أولى ثانوي</option>
          <option>تانية ثانوي</option>
          <option>تالتة ثانوي</option>
        </select>
        <button className="btn btn-primary" type="submit">بحث</button>
      </form>
      {error && <div className="error-toast">{error}</div>}
      {loading && <div className="dashboard-state"><LoaderCircle className="spin" /> جاري التحميل...</div>}
      <div className="management-list">
        {students.map((student) => (
          <article key={student.email}>
            <div onClick={() => setExpanded(expanded === student.email ? null : student.email)} style={{ cursor: "pointer" }}>
              <strong>{student.name || student.email}</strong>
              <small>{student.grade}{student.section ? ` — ${student.section}` : ""} · {student.governorate} · {student.activeEnrollments} اشتراك · {student.totalAttempts} محاولة</small>
              <small style={{ opacity: 0.6 }}>{student.email}</small>
            </div>
            {expanded === student.email && (
              <div className="student-detail-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.5rem", padding: "0.75rem", background: "var(--surface-2, rgba(0,0,0,0.05))", borderRadius: "8px", marginTop: "0.5rem", fontSize: "0.85rem" }}>
                <div><b>الموبايل:</b> {student.phone || "—"}</div>
                <div><b>هاتف الأب:</b> {student.fatherPhone || "—"}</div>
                <div><b>هاتف الأم:</b> {student.motherPhone || "—"}</div>
                <div><b>المدرسة:</b> {student.schoolName || "—"}</div>
                <div><b>المحافظة:</b> {student.governorate || "—"}</div>
                <div><b>النوع:</b> {student.gender || "—"}</div>
                <div><b>الصف:</b> {student.grade} {student.section}</div>
                <div><b>تاريخ التسجيل:</b> {student.createdAt ? new Date(student.createdAt).toLocaleDateString("ar-EG") : "—"}</div>
              </div>
            )}
          </article>
        ))}
        {!loading && students.length === 0 && <div className="empty-state">لا توجد نتائج.</div>}
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => void loadStudents(page - 1)}>السابق</button>
          <span style={{ lineHeight: "2.5rem" }}>صفحة {page} من {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => void loadStudents(page + 1)}>التالي</button>
        </div>
      )}
    </section>
  );
}
