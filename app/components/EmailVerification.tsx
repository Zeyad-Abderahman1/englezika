'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, MailCheck } from 'lucide-react';

export default function EmailVerification({
  email,
  onVerified,
}: {
  email: string;
  onVerified: () => void | Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setInterval(() => {
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const sendCode = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await fetch('/api/auth/send-code', { method: 'POST' });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      retryAfter?: number;
      verified?: boolean;
      testCode?: string;
    };
    setBusy(false);
    if (!response.ok) {
      setError(result.error || 'تعذر إرسال كود التفعيل');
      if (result.retryAfter) setResendIn(result.retryAfter);
      return;
    }
    if (result.verified) {
      await onVerified();
      return;
    }
    setResendIn(60);
    if (result.testCode) {
      setCode(result.testCode);
      setMessage(`كود التفعيل لتجربة الموقع هو: ${result.testCode}`);
    } else {
      setMessage('تم إرسال الكود. راجع البريد الوارد والرسائل غير المرغوب فيها.');
    }
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('أدخل الكود المكون من 6 أرقام');
      return;
    }
    setBusy(true);
    setError('');
    const response = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error || 'تعذر تأكيد الكود');
      return;
    }
    setMessage('تم تأكيد بريدك بنجاح.');
    await onVerified();
  };

  return (
    <section className="verification-card" aria-labelledby="verification-title">
      <div className="verification-icon">
        <MailCheck />
      </div>
      <span className="section-label">حماية الحساب</span>
      <h2 id="verification-title">أكد بريدك الإلكتروني</h2>
      <p>
        سنرسل كودًا من 6 أرقام إلى <strong dir="ltr">{email}</strong>. الكود صالح لمدة 10 دقائق.
      </p>
      <button
        type="button"
        className="btn btn-outline"
        disabled={busy || resendIn > 0}
        onClick={() => void sendCode()}
      >
        {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
        {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ثانية` : 'إرسال كود التفعيل'}
      </button>
      <form onSubmit={verifyCode} className="verification-form">
        <label htmlFor="verification-code">كود التفعيل</label>
        <input
          id="verification-code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="000000"
          aria-describedby="verification-help"
        />
        <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />} تأكيد البريد
        </button>
      </form>
      <small id="verification-help">لن نطلب منك مشاركة هذا الكود مع أي شخص.</small>
      {message && (
        <div className="inline-success" role="status">
          <CheckCircle2 /> {message}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
