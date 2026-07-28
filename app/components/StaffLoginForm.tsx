'use client';

import { FormEvent, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';

export default function StaffLoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'تعذر تسجيل الدخول');
      window.location.assign('/admin');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="teacher-login-page" dir="rtl">
      <section className="teacher-login-shell">
        <div className="teacher-login-intro">
          <div className="teacher-login-brand">
            <BookOpen />
            <strong>Englizeka</strong>
          </div>
          <div>
            <span>بوابة المدرس</span>
            <h1>
              كل أدوات منصتك
              <br />
              في مكان واحد.
            </h1>
            <p>أضف الكورسات والمحاضرات، أنشئ الامتحانات، وتابع تقدم طلابك بسهولة.</p>
          </div>
          <div className="teacher-login-features">
            <span>
              <ShieldCheck /> دخول آمن للمدرس فقط
            </span>
            <span>
              <LockKeyhole /> المحتوى والطلاب محميون
            </span>
          </div>
        </div>

        <div className="teacher-login-form-wrap">
          <div className="teacher-login-icon">
            <ShieldCheck />
          </div>
          <span className="section-label">مرحبًا بعودتك</span>
          <h2>تسجيل دخول المدرس</h2>
          <p>أدخل بيانات حساب المدرس للوصول إلى لوحة التحكم.</p>
          <form className="teacher-login-form" onSubmit={submit}>
            <label>
              <span>
                <Mail /> البريد الإلكتروني
              </span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                defaultValue="admin@englizeka.com"
                required
              />
            </label>
            <label>
              <span>
                <KeyRound /> كلمة المرور
              </span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="أدخل كلمة المرور"
                required
              />
            </label>
            {error && (
              <div className="teacher-login-error">
                <LockKeyhole /> {error}
              </div>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" />
              ) : (
                <>
                  <span>دخول لوحة المدرس</span>
                  <ArrowLeft />
                </>
              )}
            </button>
          </form>
          <small>
            <LockKeyhole /> هذه المساحة خاصة بالمدرس والحسابات المصرّح لها فقط.
          </small>
        </div>
      </section>
    </main>
  );
}
