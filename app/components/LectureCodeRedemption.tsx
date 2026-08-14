'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, KeyRound, LoaderCircle, Play } from 'lucide-react';

type RedeemedLecture = {
  videoId: string;
  videoTitle: string;
  courseId: string;
  courseTitle: string;
  watchUrl: string;
};

function formatLectureCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 33);
  const payload = normalized.startsWith('ENG') ? normalized.slice(3) : normalized;
  const groups = payload.match(/.{1,5}/g) ?? [];
  return ['ENG', ...groups].join('-');
}

export default function LectureCodeRedemption({ onRedeemed }: { onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lecture, setLecture] = useState<RedeemedLecture | null>(null);
  const [errorKind, setErrorKind] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setErrorKind('');
    setLecture(null);
    try {
      const response = await fetch('/api/lecture-access-codes/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        lecture?: RedeemedLecture;
      };
      if (!response.ok || !result.lecture) {
        setErrorKind(response.status === 409 ? 'used' : response.status === 429 ? 'limited' : 'invalid');
        throw new Error(
          response.status === 409
            ? 'هذا الكود تم استخدامه من قبل.'
            : response.status === 429
              ? 'تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقًا.'
              : response.status >= 500
                ? 'تعذر الاتصال بالخدمة الآن. حاول مرة أخرى.'
                : 'الكود غير صحيح. راجعه ثم حاول مرة أخرى.'
        );
      }
      setLecture(result.lecture);
      setCode('');
      await onRedeemed();
    } catch (redemptionError) {
      setError(redemptionError instanceof Error ? redemptionError.message : 'تعذر تفعيل الكود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`student-card lecture-redemption-card ${lecture ? 'is-success' : ''}`}>
      <div className="lecture-redemption-heading">
        <span><KeyRound /></span>
        <div>
          <small>وصول مجاني لمحاضرة واحدة</small>
          <h2>استخدام كود المحاضرة</h2>
          <p>أدخل الكود الذي حصلت عليه من المدرس لفتح المحاضرة المحددة فقط.</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <label htmlFor="lecture-access-code">كود المحاضرة</label>
        <input
          id="lecture-access-code"
          dir="ltr"
          value={code}
          onChange={(event) => {
            setCode(formatLectureCode(event.target.value));
            if (error) {
              setError('');
              setErrorKind('');
            }
          }}
          placeholder="ENG-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="off"
          spellCheck={false}
          maxLength={96}
          required
          aria-describedby={`lecture-code-hint${error ? ' lecture-code-error' : ''}`}
          aria-invalid={Boolean(error)}
        />
        <small id="lecture-code-hint">الكود يعمل مرة واحدة لطالب واحد، ولا يفتح باقي الكورس.</small>
        <button className="btn btn-primary" disabled={busy || !code.trim()}>
          {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
          {busy ? 'جاري تفعيل الكود...' : 'تفعيل الكود'}
        </button>
      </form>
      {error && <p id="lecture-code-error" className={`lecture-redemption-error error-${errorKind}`} role="alert">{error}</p>}
      {lecture && (
        <div className="lecture-redemption-success" role="status" aria-live="polite">
          <CheckCircle2 />
          <div>
            <strong>تم تفعيل الكود بنجاح</strong>
            <p>يمكنك الآن مشاهدة «{lecture.videoTitle}» من كورس «{lecture.courseTitle}».</p>
          </div>
          <Link className="btn btn-primary" href={lecture.watchUrl}>
            مشاهدة المحاضرة <Play />
          </Link>
        </div>
      )}
    </section>
  );
}
