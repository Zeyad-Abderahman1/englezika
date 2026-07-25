"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

export default function StaffLoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "تعذر تسجيل الدخول");
      window.location.assign("/admin");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="staff-login-page" dir="rtl">
      <section className="staff-login-card">
        <div className="staff-login-mark"><ShieldCheck /></div>
        <span className="section-label">منطقة خاصة</span>
        <h1>دخول المدرس والمساعدين</h1>
        <p>هذه الصفحة لحسابات فريق Englizeka التي أنشأها المدرس فقط.</p>
        <form className="stack-form" onSubmit={submit}>
          <label><span><Mail /> البريد الإلكتروني</span><input name="email" type="email" autoComplete="username" required /></label>
          <label><span><KeyRound /> كلمة المرور</span><input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <div className="error-toast"><LockKeyhole /> {error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />} دخول لوحة الفريق</button>
        </form>
        <small>يتم قفل المحاولات المتكررة وتسجيل الجلسة في ملف ارتباط آمن.</small>
      </section>
    </main>
  );
}
