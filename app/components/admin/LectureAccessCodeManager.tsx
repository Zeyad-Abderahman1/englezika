'use client';

import { useMemo, useState } from 'react';
import { Check, Clipboard, KeyRound, LoaderCircle } from 'lucide-react';

export type LectureAccessCodeHistory = {
  id: string;
  videoId: string;
  displaySuffix: string;
  createdAt: number;
  redeemedAt: number | null;
  videoTitle: string;
  courseTitle: string;
};

export function LectureAccessCodeManager({
  videoId,
  videoTitle,
  history,
  onGenerated,
}: {
  videoId: string;
  videoTitle: string;
  history: LectureAccessCodeHistory[];
  onGenerated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const videoHistory = useMemo(
    () => history.filter((item) => item.videoId === videoId),
    [history, videoId]
  );

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setGeneratedCode('');
    try {
      const response = await fetch(`/api/admin/videos/${encodeURIComponent(videoId)}/access-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const result = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok || !result.code) throw new Error(result.error || 'تعذر إنشاء الكود');
      setGeneratedCode(result.code);
      await onGenerated();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'تعذر إنشاء الكود');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!generatedCode) return;
    setCopied(true);
    try {
      await navigator.clipboard.writeText(generatedCode);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setError('تعذر نسخ الكود تلقائيًا. يمكنك نسخه يدويًا.');
    }
  };

  return (
    <div className={`lecture-code-manager ${generatedCode ? 'has-generated-code' : ''}`}>
      <button type="button" className="status-button lecture-code-trigger" onClick={generate} disabled={busy}>
        {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
        {busy ? 'جاري إنشاء الكود...' : 'إنشاء كود محاضرة'}
      </button>
      {generatedCode && (
        <div className="generated-lecture-code" role="status" aria-live="polite">
          <div>
            <strong>الكود جاهز — سيظهر كاملًا هذه المرة فقط</strong>
            <p>يعمل لطالب واحد مرة واحدة، ويفتح محاضرة «{videoTitle}» فقط.</p>
          </div>
          <code dir="ltr">{generatedCode}</code>
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? <Check /> : <Clipboard />} {copied ? 'تم النسخ' : 'نسخ الكود'}
          </button>
        </div>
      )}
      {error && <p className="lecture-code-error" role="alert">تعذر إنشاء الكود الآن. حاول مرة أخرى.</p>}
      {videoHistory.length > 0 && (
        <details className="lecture-code-history">
          <summary>سجل الأكواد ({videoHistory.length})</summary>
          <div>
            {videoHistory.map((item) => (
              <article key={item.id}>
                <span>
                  <bdi dir="ltr">•••••-{item.displaySuffix}</bdi>
                  <small>{new Date(item.createdAt).toLocaleString('ar-EG')}</small>
                </span>
                <span className={`status-pill ${item.redeemedAt ? 'status-approved' : 'status-pending'}`}>
                  {item.redeemedAt ? 'مُستخدم' : 'غير مستخدم'}
                </span>
                {item.redeemedAt && <small>استُخدم {new Date(item.redeemedAt).toLocaleString('ar-EG')}</small>}
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
