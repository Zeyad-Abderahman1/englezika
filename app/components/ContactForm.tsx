'use client';

import { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';

export default function ContactForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <form
      className="form-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        setError('');
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(form)),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setSending(false);
        if (!response.ok) return setError(result.error || 'تعذر إرسال الرسالة');
        setSent(true);
        formEl.reset();
      }}
    >
      <label>
        الاسم
        <input required name="name" minLength={2} maxLength={100} placeholder="اكتب اسمك" />
      </label>
      <label>
        رقم الموبايل
        <input
          required
          name="phone"
          minLength={8}
          maxLength={30}
          inputMode="tel"
          placeholder="01xxxxxxxxx"
        />
      </label>
      <label>
        رسالتك
        <textarea
          required
          name="message"
          minLength={5}
          maxLength={2000}
          rows={5}
          placeholder="قول لنا نقدر نساعدك إزاي"
        />
      </label>
      <button className="btn btn-primary btn-large" type="submit" disabled={sending}>
        <Send size={18} /> {sending ? 'جاري الإرسال...' : 'ابعت رسالتك'}
      </button>
      {sent && (
        <div className="success-toast" role="status">
          <CheckCircle2 /> وصلتنا رسالتك، وهنرد عليك في أقرب وقت.
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
