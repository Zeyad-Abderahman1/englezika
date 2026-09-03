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

export type AccessCodeBatch = {
  id: string;
  course_id: string;
  video_id: string;
  count: number;
  created_by: string;
  created_at: number;
  video_title: string | null;
  course_title: string | null;
};

export function LectureAccessCodeManager({
  videoId,
  videoTitle,
  history,
  batches,
  onGenerated,
}: {
  videoId: string;
  videoTitle: string;
  history: LectureAccessCodeHistory[];
  batches?: AccessCodeBatch[];
  onGenerated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
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

  const bulkGenerate = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/access-codes/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, count: 5 }),
      });
      const result = (await response.json().catch(() => ({}))) as { codes?: Array<{ fullCode: string }>; error?: string };
      if (!response.ok || !result.codes) throw new Error(result.error || 'تعذر إنشاء الأكواد');
      await onGenerated();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'تعذر إنشاء الأكواد');
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const response = await fetch('/api/admin/access-codes/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || 'تعذر تحميل الملف');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `access-codes-${videoId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'تعذر تحميل ملف الأكواد');
    }
  };

  return (
    <div className={`lecture-code-manager ${generatedCode ? 'has-generated-code' : ''}`}>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <button type="button" className="status-button lecture-code-trigger" onClick={generate} disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
          {busy ? 'جاري إنشاء الكود...' : 'إنشاء كود محاضرة'}
        </button>
        <button type="button" className="status-button lecture-code-trigger" onClick={bulkGenerate} disabled={bulkBusy}>
          {bulkBusy ? <LoaderCircle className="spin" /> : <KeyRound />}
          {bulkBusy ? 'جاري إنشاء...' : 'إنشاء 5 أكواد'}
        </button>
        {videoHistory.length > 0 && (
          <button type="button" className="status-button lecture-code-trigger" onClick={downloadPdf}>
            تحميل PDF
          </button>
        )}
      </div>
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
      {batches && batches.length > 0 && (
        <details className="lecture-code-history">
          <summary>سجل الدفعات ({batches.length})</summary>
          <div>
            {batches.map((batch) => (
              <article key={batch.id}>
                <span>
                  <strong>{batch.count} كود</strong>
                  <small>{new Date(batch.created_at).toLocaleString('ar-EG')}</small>
                  {batch.video_title && <small>{batch.video_title}</small>}
                  {batch.course_title && <small>{batch.course_title}</small>}
                </span>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
