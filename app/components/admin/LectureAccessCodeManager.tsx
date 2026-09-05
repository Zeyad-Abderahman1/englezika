'use client';

import { useMemo, useState } from 'react';
import { Check, Clipboard, Download, FileText, KeyRound, LoaderCircle, Sparkles } from 'lucide-react';

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
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatedBatch, setGeneratedBatch] = useState<Array<{ id: string; suffix: string; fullCode: string }> | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedBatch, setCopiedBatch] = useState(false);
  const [error, setError] = useState('');
  const [customCount, setCustomCount] = useState<number>(5);
  const [showBulkOptions, setShowBulkOptions] = useState(false);

  const videoHistory = useMemo(
    () => history.filter((item) => item.videoId === videoId),
    [history, videoId]
  );

  const videoBatches = useMemo(
    () => (batches || []).filter((b) => b.video_id === videoId),
    [batches, videoId]
  );

  const generateSingle = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setGeneratedCode('');
    setGeneratedBatch(null);
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
      setError(generationError instanceof Error ? generationError.message : 'تعذر إنشاء الكود الآن. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const generateBulk = async (requestedCount: number) => {
    if (bulkBusy) return;
    const safeCount = Math.max(1, Math.min(500, Math.floor(requestedCount || 5)));
    setBulkBusy(true);
    setError('');
    setGeneratedCode('');
    setGeneratedBatch(null);
    try {
      const response = await fetch('/api/admin/access-codes/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, count: safeCount }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        codes?: Array<{ id: string; suffix: string; fullCode: string }>;
        error?: string;
      };
      if (!response.ok || !result.codes || !result.codes.length) {
        throw new Error(result.error || 'تعذر إنشاء الأكواد في الدفعة');
      }
      setGeneratedBatch(result.codes);
      await onGenerated();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'تعذر إنشاء الأكواد الآن. حاول مرة أخرى.');
    } finally {
      setBulkBusy(false);
      setShowBulkOptions(false);
    }
  };

  const copySingle = async () => {
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

  const copyAllBatch = async () => {
    if (!generatedBatch || !generatedBatch.length) return;
    setCopiedBatch(true);
    try {
      const text = generatedBatch.map((c) => c.fullCode).join('\n');
      await navigator.clipboard.writeText(text);
      window.setTimeout(() => setCopiedBatch(false), 2000);
    } catch {
      setCopiedBatch(false);
      setError('تعذر نسخ قائمة الأكواد.');
    }
  };

  const downloadPdf = async (codesToExport: string[]) => {
    if (downloadingPdf || !codesToExport || codesToExport.length === 0) return;
    setDownloadingPdf(true);
    setError('');
    try {
      const response = await fetch('/api/admin/access-codes/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, codes: codesToExport }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(result.message || result.error || 'تعذر تحميل الملف');
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
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className={`lecture-code-manager ${generatedCode || generatedBatch ? 'has-generated-code' : ''}`}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="status-button lecture-code-trigger"
          onClick={generateSingle}
          disabled={busy || bulkBusy}
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}
          {busy ? 'جاري إنشاء الكود...' : 'إنشاء كود محاضرة'}
        </button>

        <button
          type="button"
          className="status-button lecture-code-trigger"
          onClick={() => setShowBulkOptions(!showBulkOptions)}
          disabled={busy || bulkBusy}
        >
          {bulkBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
          {bulkBusy ? 'جاري إنشاء الأكواد...' : 'إنشاء دفعة أكواد'}
        </button>
      </div>

      {showBulkOptions && (
        <div
          style={{
            margin: '8px 0',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.85rem', color: 'var(--muted, #aaa)' }}>عدد الأكواد:</span>
          {[5, 10, 100].map((num) => (
            <button
              key={num}
              type="button"
              className="btn btn-sm btn-outline"
              style={{ fontSize: '0.8rem', padding: '3px 10px' }}
              onClick={() => generateBulk(num)}
              disabled={bulkBusy}
            >
              {num} أكواد
            </button>
          ))}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="number"
              min={1}
              max={500}
              value={customCount}
              onChange={(e) => setCustomCount(Number(e.target.value))}
              style={{
                width: '65px',
                padding: '3px 6px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: '#111',
                color: '#fff',
                fontSize: '0.85rem',
                textAlign: 'center',
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ fontSize: '0.8rem', padding: '3px 10px' }}
              onClick={() => generateBulk(customCount)}
              disabled={bulkBusy || customCount < 1}
            >
              إنشاء
            </button>
          </div>
        </div>
      )}

      {/* Single code result display */}
      {generatedCode && (
        <div className="generated-lecture-code" role="status" aria-live="polite">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span className="status-pill status-approved" style={{ fontSize: '0.78rem' }}>احفظ الكود الآن</span>
              <strong>سيظهر كاملًا هذه المرة فقط</strong>
            </div>
            <p>يعمل لطالب واحد مرة واحدة، ويفتح محاضرة «{videoTitle}» فقط.</p>
          </div>
          <code dir="ltr">{generatedCode}</code>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button type="button" className="btn btn-primary" onClick={copySingle}>
              {copied ? <Check size={16} /> : <Clipboard size={16} />} {copied ? 'تم النسخ' : 'نسخ الكود'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => downloadPdf([generatedCode])}
              disabled={downloadingPdf}
            >
              {downloadingPdf ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{' '}
              تحميل PDF
            </button>
          </div>
        </div>
      )}

      {/* Bulk batch result display */}
      {generatedBatch && generatedBatch.length > 0 && (
        <div className="generated-lecture-code" role="status" aria-live="polite">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span className="status-pill status-approved" style={{ fontSize: '0.78rem' }}>احفظ الأكواد الآن</span>
              <strong>تم إنشاء {generatedBatch.length} كود بنجاح (تظهر كاملة هذه المرة فقط)</strong>
            </div>
            <p>الأكواد تفتح محاضرة «{videoTitle}» لطالب واحد مرة واحدة لكل كود.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={copyAllBatch}>
              {copiedBatch ? <Check size={14} /> : <Clipboard size={14} />}{' '}
              {copiedBatch ? 'تم نسخ جميع الأكواد' : 'نسخ جميع الأكواد'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => downloadPdf(generatedBatch.map((c) => c.fullCode))}
              disabled={downloadingPdf}
            >
              {downloadingPdf ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{' '}
              تحميل PDF للأكواد المُنشأة
            </button>
          </div>
          <details style={{ marginTop: '6px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--muted, #aaa)' }}>
              معاينة قائمة الأكواد ({generatedBatch.length})
            </summary>
            <div
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                background: 'rgba(0,0,0,0.3)',
                padding: '8px',
                borderRadius: '6px',
                marginTop: '6px',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
              }}
              dir="ltr"
            >
              {generatedBatch.map((item, idx) => (
                <div key={item.id} style={{ padding: '2px 0' }}>
                  {idx + 1}. {item.fullCode}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {error && (
        <p className="lecture-code-error" role="alert" style={{ color: '#ef4444', marginTop: '6px', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}

      {/* History of generated single codes */}
      {videoHistory.length > 0 && (
        <details className="lecture-code-history">
          <summary>سجل الأكواد الفردية ({videoHistory.length})</summary>
          <div
            style={{
              padding: '8px 12px',
              fontSize: '0.8rem',
              color: 'var(--muted, #aaa)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            لأسباب أمنية لا يتم تخزين الأكواد بصورتها الأصلية في النظام. يجب نسخ الأكواد أو تحميل ملف PDF فور إنشائها مباشرة.
          </div>
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

      {/* Batches history */}
      {videoBatches.length > 0 && (
        <details className="lecture-code-history">
          <summary>سجل الدفعات ({videoBatches.length})</summary>
          <div>
            {videoBatches.map((batch) => (
              <article key={batch.id}>
                <span>
                  <strong>{batch.count} كود</strong>
                  <small>{new Date(batch.created_at).toLocaleString('ar-EG')}</small>
                  {batch.created_by && <small>بواسطة: {batch.created_by}</small>}
                </span>
                <span className="status-pill status-approved">مكتملة</span>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
