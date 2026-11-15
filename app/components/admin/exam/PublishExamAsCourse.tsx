'use client';

/**
 * app/components/admin/exam/PublishExamAsCourse.tsx
 *
 * Shared section used on EVERY exam creation path (manual form, OCR, PDF generator,
 * stage-exam generator) and on the exam edit screen:
 *   1. ExamThumbnailField — optional, always visible, never blocks creation.
 *   2. A collapsed-by-default, off-by-default block to publish the exam as a standalone
 *      course for ALL classes (price, description, public page, top-10 leaderboard).
 * It only edits a draft object; the caller applies it with applyExamPublishing().
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import type { ExamPublishingDraft } from '../../../lib/exam-publishing-client';
import './exam-publishing.css';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ExamThumbnailFieldProps {
  file: File | null;
  existingUrl?: string;
  removed?: boolean;
  disabled?: boolean;
  onChange: (file: File | null) => void;
  onRemoveExisting?: () => void;
}

/** Upload, preview, replace and remove. Same limits and messages as the course form. */
export function ExamThumbnailField({
  file,
  existingUrl,
  removed,
  disabled,
  onChange,
  onRemoveExisting,
}: ExamThumbnailFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const choose = (picked: File | undefined) => {
    setError('');
    setNote('');
    if (!picked) return;
    if (!IMAGE_TYPES.includes(picked.type)) {
      setError('يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP.');
      return;
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      setError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت).');
      return;
    }
    onChange(picked);
  };

  const shown = previewUrl || (!removed && existingUrl) || '';

  return (
    <div className="exam-thumb-field">
      <span className="exam-pub-label">صورة الامتحان (اختيارية — يفضّل 16:9)</span>
      <div className="exam-thumb-row">
        <div className="exam-thumb-box">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview / cached artwork
            <img
              src={shown}
              alt="صورة الامتحان"
              width={320}
              height={180}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (previewUrl && naturalHeight > 0 && Math.abs(naturalWidth / naturalHeight - 16 / 9) > 0.15) {
                  setNote('ملحوظة: الصورة ليست بنسبة 16:9، وقد تُقتطع أطرافها في بعض العروض.');
                }
              }}
            />
          ) : (
            <span className="exam-thumb-placeholder" aria-hidden="true">
              <ImagePlus size={26} />
            </span>
          )}
        </div>
        <div className="exam-thumb-actions">
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="exam-pub-hidden"
            tabIndex={-1}
            onChange={(event) => {
              choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="exam-pub-btn"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {shown ? <RefreshCw size={15} aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
            {shown ? 'استبدال الصورة' : 'اختيار صورة'}
          </button>
          {(file || (existingUrl && !removed)) && (
            <button
              type="button"
              className="exam-pub-btn exam-pub-btn-ghost"
              disabled={disabled}
              onClick={() => {
                setError('');
                setNote('');
                if (file) onChange(null);
                else onRemoveExisting?.();
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> إزالة
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="exam-pub-error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="exam-pub-note">{note}</p>}
    </div>
  );
}

interface PublishExamAsCourseProps {
  value: ExamPublishingDraft;
  onChange: (next: ExamPublishingDraft) => void;
  existingThumbnailUrl?: string;
  /** When editing an exam that is already a course, start expanded. */
  defaultOpen?: boolean;
  disabled?: boolean;
}

export function PublishExamAsCourse({
  value,
  onChange,
  existingThumbnailUrl,
  defaultOpen = false,
  disabled,
}: PublishExamAsCourseProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const patch = (next: Partial<ExamPublishingDraft>) => onChange({ ...value, ...next });

  return (
    <section className="exam-pub-section" aria-label="صورة الامتحان والنشر ككورس">
      <ExamThumbnailField
        file={value.thumbnailFile}
        existingUrl={existingThumbnailUrl}
        removed={value.removeThumbnail}
        disabled={disabled}
        onChange={(file) => patch({ thumbnailFile: file, removeThumbnail: false })}
        onRemoveExisting={() => patch({ removeThumbnail: true })}
      />

      <div className="exam-pub-card">
        <button
          type="button"
          className="exam-pub-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <span>نشر الامتحان ككورس لكل الصفوف</span>
          <span className="exam-pub-toggle-state">{value.enabled ? 'مفعّل' : 'غير مفعّل'}</span>
          <ChevronDown size={18} aria-hidden="true" className={open ? 'is-open' : ''} />
        </button>

        {open && (
          <div id={panelId} className="exam-pub-panel">
            <label className="exam-pub-check">
              <input
                type="checkbox"
                checked={value.enabled}
                disabled={disabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              <span>نشر الامتحان ككورس لكل الصفوف</span>
            </label>
            <p className="exam-pub-hint">
              يظهر الامتحان في قائمة الكورسات لطلاب كل الصفوف، ويشترك الطالب أو يدفع بنفس طريقة الكورسات العادية.
            </p>

            {value.enabled && (
              <>
                <label className="exam-pub-field">
                  <span className="exam-pub-label">السعر بالجنيه (0 = مجاني)</span>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    inputMode="numeric"
                    value={value.price}
                    disabled={disabled}
                    onChange={(event) => patch({ price: event.target.value })}
                  />
                </label>

                <label className="exam-pub-field">
                  <span className="exam-pub-label">وصف مختصر</span>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={value.description}
                    disabled={disabled}
                    onChange={(event) => patch({ description: event.target.value })}
                    placeholder="يظهر في قائمة الكورسات وفي الصفحة العامة"
                  />
                </label>

                <label className="exam-pub-check">
                  <input
                    type="checkbox"
                    checked={value.isPublic}
                    disabled={disabled}
                    onChange={(event) => patch({ isPublic: event.target.checked })}
                  />
                  <span>إنشاء صفحة عامة للامتحان (يمكن مشاركتها بدون تسجيل دخول)</span>
                </label>

                <label className="exam-pub-check">
                  <input
                    type="checkbox"
                    checked={value.showLeaderboard}
                    disabled={disabled || !value.isPublic}
                    onChange={(event) => patch({ showLeaderboard: event.target.checked })}
                  />
                  <span>إظهار لوحة أفضل 10 طلاب</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
