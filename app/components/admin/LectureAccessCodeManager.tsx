'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Download,
  FileText,
  LoaderCircle,
  QrCode,
  Sparkles,
  UserCheck,
} from 'lucide-react';

export type LectureAccessCodeHistory = {
  id: string;
  videoId: string;
  displaySuffix: string;
  createdAt: number;
  redeemedAt: number | null;
  redeemedByStudentEmail?: string | null;
  batchId?: string | null;
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
  const [busy, setBulkBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [lastGeneratedQRs, setLastGeneratedQRs] = useState<Array<{
    id: string;
    suffix: string;
    token: string;
    url: string;
  }> | null>(null);
  const [error, setError] = useState('');
  const [customCount, setCustomCount] = useState<number>(10);
  const [showQuantityModal, setShowQuantityModal] = useState(false);

  const videoHistory = useMemo(
    () => history.filter((item) => item.videoId === videoId),
    [history, videoId]
  );

  const videoBatches = useMemo(
    () => (batches || []).filter((b) => b.video_id === videoId),
    [batches, videoId]
  );

  const generateQRCodes = async (requestedCount: number) => {
    if (busy) return;
    const safeCount = Math.max(1, Math.min(500, Math.floor(requestedCount || 5)));
    setBulkBusy(true);
    setError('');
    setLastGeneratedQRs(null);
    try {
      const response = await fetch('/api/admin/qr/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, count: safeCount }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        qrCodes?: Array<{ id: string; suffix: string; token: string; url: string }>;
        error?: string;
      };
      const generatedList = result.qrCodes;
      if (!response.ok || !generatedList || !generatedList.length) {
        throw new Error(result.error || 'تعذر إنشاء رموز QR في الخادم');
      }

      const formatted = generatedList.map((c) => ({
        id: c.id,
        suffix: c.suffix,
        token: c.token || '',
        url: c.url || '',
      }));

      setLastGeneratedQRs(formatted);
      await onGenerated();
      setShowQuantityModal(false);

      // Auto-trigger PDF download for convenience
      await downloadPdf(formatted.map((c) => c.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء رموز QR الآن. حاول مرة أخرى.');
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadPdf = async (tokensToExport: string[]) => {
    if (downloadingPdf || !tokensToExport || tokensToExport.length === 0) return;
    setDownloadingPdf(true);
    setError('');
    try {
      const response = await fetch('/api/admin/qr/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, tokens: tokensToExport }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(result.message || result.error || 'تعذر إنشاء ملف PDF لرموز QR');
      }
      const blob = await response.blob();
      const fileBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(fileBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lecture-qr-codes-${videoId}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 60000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل ملف PDF لرموز QR');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className={`lecture-code-manager ${lastGeneratedQRs ? 'has-generated-code' : ''}`} dir="rtl">
      {/* Trigger & Quantity Controls */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="status-button lecture-code-trigger"
          onClick={() => setShowQuantityModal(!showQuantityModal)}
          disabled={busy || downloadingPdf}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            fontWeight: 600,
          }}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <QrCode size={15} />}
          {busy ? 'جاري إنشاء رموز QR...' : 'توليد رموز QR للمحاضرة'}
        </button>
      </div>

      {/* Quantity Selector Panel */}
      {showQuantityModal && (
        <div
          style={{
            margin: '10px 0',
            padding: '14px 16px',
            background: 'var(--surface-overlay, rgba(255,255,255,0.05))',
            border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary, #fff)' }}>
              اختر عدد رموز QR المراد توليدها وطباعتها:
            </span>
            <small style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.78rem' }}>
              كل رمز صالح لاستخدام واحد لطالب واحد
            </small>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[5, 10, 25, 50, 100].map((num) => (
              <button
                key={num}
                type="button"
                className="btn btn-sm btn-outline"
                style={{
                  fontSize: '0.85rem',
                  padding: '5px 14px',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
                onClick={() => generateQRCodes(num)}
                disabled={busy}
              >
                {num} رمز QR
              </button>
            ))}

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: 'auto' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--muted, #94a3b8)' }}>أو عدد مخصص:</span>
              <input
                type="number"
                min={1}
                max={500}
                value={customCount}
                onChange={(e) => setCustomCount(Number(e.target.value))}
                style={{
                  width: '75px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#111',
                  color: '#fff',
                  fontSize: '0.88rem',
                  textAlign: 'center',
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                style={{ fontSize: '0.85rem', padding: '5px 14px', borderRadius: '6px' }}
                onClick={() => generateQRCodes(customCount)}
                disabled={busy || customCount < 1}
              >
                إنشاء وتحميل PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Batch Success Banner */}
      {lastGeneratedQRs && lastGeneratedQRs.length > 0 && (
        <div
          className="generated-lecture-code"
          role="status"
          aria-live="polite"
          style={{
            margin: '12px 0',
            padding: '16px',
            borderRadius: '10px',
            border: '1px solid #10b981',
            background: 'rgba(16, 185, 129, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span className="status-pill status-approved" style={{ fontSize: '0.82rem' }}>
                  جاهز للطباعة والمسح
                </span>
                <strong style={{ fontSize: '1rem' }}>
                  تم توليد {lastGeneratedQRs.length} رمز QR بنجاح لمحاضرة «{videoTitle}»
                </strong>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted, #94a3b8)' }}>
                يقوم الطالب بمسح الرمز بكاميرا الهاتف لفتح المحاضرة مباشرة على حسابه. كل رمز صالح للاستخدام مرة واحدة فقط.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadPdf(lastGeneratedQRs.map((q) => q.token))}
              disabled={downloadingPdf}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                fontWeight: 700,
              }}
            >
              {downloadingPdf ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
              تحميل ملف PDF للطباعة (A4)
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="lecture-code-error" role="alert" style={{ color: '#ef4444', marginTop: '8px', fontSize: '0.88rem' }}>
          {error}
        </p>
      )}

      {/* QR Codes History & Status */}
      {videoHistory.length > 0 && (
        <details className="lecture-code-history" style={{ marginTop: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            سجل رموز QR ({videoHistory.length} رمز)
          </summary>
          <div
            style={{
              padding: '8px 12px',
              fontSize: '0.8rem',
              color: 'var(--muted, #94a3b8)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            لأسباب أمنية مشددة، يتم تخزين بصمة الرمز فقط مشفرة في قاعدة البيانات. تتبع هنا حالة استخدام الرموز:
          </div>
          <div>
            {videoHistory.map((item) => (
              <article key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <bdi dir="ltr" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    ID: ••••{item.displaySuffix}
                  </bdi>
                  <small style={{ color: 'var(--muted, #94a3b8)' }}>
                    أُنشئ: {new Date(item.createdAt).toLocaleString('ar-EG')}
                  </small>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {item.redeemedAt ? (
                    <div style={{ textAlign: 'left' }}>
                      <span className="status-pill status-used" style={{ background: '#334155', color: '#cbd5e1' }}>
                        مُستخدم
                      </span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted, #94a3b8)', marginTop: '2px' }}>
                        {item.redeemedByStudentEmail && (
                          <div>بواسطة: {item.redeemedByStudentEmail}</div>
                        )}
                        <div>بتاريخ: {new Date(item.redeemedAt).toLocaleString('ar-EG')}</div>
                      </div>
                    </div>
                  ) : (
                    <span className="status-pill status-approved" style={{ background: '#065f46', color: '#a7f3d0' }}>
                      متاح (غير مستخدم)
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}

      {/* Batches History */}
      {videoBatches.length > 0 && (
        <details className="lecture-code-history" style={{ marginTop: '8px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            سجل دفعات QR ({videoBatches.length} دفعة)
          </summary>
          <div>
            {videoBatches.map((batch) => (
              <article key={batch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span>
                  <strong>{batch.count} رمز QR</strong>
                  <small style={{ display: 'block', color: 'var(--muted, #94a3b8)' }}>
                    {new Date(batch.created_at).toLocaleString('ar-EG')}
                  </small>
                  {batch.created_by && (
                    <small style={{ color: 'var(--muted, #94a3b8)' }}>
                      بواسطة: {batch.created_by}
                    </small>
                  )}
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

export const LectureQRCodeManager = LectureAccessCodeManager;
