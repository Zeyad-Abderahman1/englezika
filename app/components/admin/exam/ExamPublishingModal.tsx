'use client';

/**
 * app/components/admin/exam/ExamPublishingModal.tsx
 *
 * Exam edit screen for the thumbnail and the "published as a course for all classes" state.
 * Lets the teacher publish or unpublish ANY existing exam later, and copy the public link.
 */

import { useState } from 'react';
import { Check, Copy, LoaderCircle, Save, X } from 'lucide-react';
import type { Exam } from '../../../lib/admin-context';
import { examThumbnailUrl } from '../../../lib/exam-listing';
import {
  applyExamPublishing,
  emptyPublishingDraft,
  publicExamUrl,
  unpublishExamListing,
  type ExamPublishingDraft,
} from '../../../lib/exam-publishing-client';
import { PublishExamAsCourse } from './PublishExamAsCourse';

interface ExamPublishingModalProps {
  exam: Exam;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}

export function ExamPublishingModal({ exam, onClose, onSaved }: ExamPublishingModalProps) {
  const [draft, setDraft] = useState<ExamPublishingDraft>({
    ...emptyPublishingDraft(),
    enabled: Boolean(exam.publishedAsCourse),
    price: String(exam.listingPrice ?? 0),
    description: exam.publishedAsCourse ? exam.description || '' : '',
    isPublic: exam.isPublic ?? true,
    showLeaderboard: exam.showLeaderboard ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [slug, setSlug] = useState<string | null>(exam.publishedAsCourse && exam.isPublic ? exam.publicSlug ?? null : null);
  const [copied, setCopied] = useState(false);

  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(publicExamUrl(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('تعذر نسخ الرابط. انسخه يدويًا من الحقل.');
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (!draft.enabled && exam.publishedAsCourse) {
        await unpublishExamListing(exam.id);
      }
      const result = await applyExamPublishing(exam.id, draft);
      if (result.warnings.length) {
        setError(result.warnings.join(' — '));
        return;
      }
      if (result.published && result.isPublic && result.publicSlug) setSlug(result.publicSlug);
      await onSaved(
        draft.enabled ? 'تم نشر الامتحان ككورس لكل الصفوف' : exam.publishedAsCourse ? 'تم إلغاء نشر الامتحان ككورس' : 'تم حفظ الإعدادات'
      );
      if (!draft.enabled || !(result.published && result.isPublic && result.publicSlug)) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر حفظ الإعدادات');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exam-publishing-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="admin-modal-card">
        <header className="admin-modal-header">
          <h3 id="exam-publishing-title" className="admin-modal-title">
            صورة الامتحان والنشر ككورس — «{exam.title}»
          </h3>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="إغلاق النافذة" disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <div className="admin-modal-form stack-form">
          <PublishExamAsCourse
            value={draft}
            onChange={setDraft}
            existingThumbnailUrl={examThumbnailUrl(exam.id, exam.thumbnailKey)}
            defaultOpen={Boolean(exam.publishedAsCourse)}
            disabled={busy}
          />

          {slug && (
            <div className="exam-pub-link-row">
              <span className="exam-pub-label">رابط الصفحة العامة</span>
              <div className="exam-pub-link-box">
                <input readOnly dir="ltr" value={publicExamUrl(slug)} aria-label="رابط الصفحة العامة" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="exam-pub-btn" onClick={() => void copyLink(slug)}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  {copied ? 'تم النسخ' : 'نسخ الرابط'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="exam-pub-error" role="alert">
              {error}
            </p>
          )}

          <footer className="admin-modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
              إغلاق
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} حفظ
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
