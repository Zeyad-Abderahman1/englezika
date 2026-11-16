'use client';

/**
 * app/components/admin/ai/AgentCards.tsx
 *
 * Interactive blocks rendered under an assistant message when the agent asks a
 * question or wants approval: quick-reply chips, the thumbnail upload zone, the
 * confirmation card (summary table + confirm / edit / cancel), and the success and
 * error cards. Only the LAST assistant message is interactive; older blocks stay
 * visible but inert so a stale card can never be pressed.
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Trash2,
  FileSearch,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react';
import type { AgentUi } from '../../../lib/ai/agent/ui-types';

export interface UploadViewState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  previewUrl?: string;
  fileName?: string;
  error?: string;
  note?: string;
}

/** Live progress of the browser-driven extraction of exam-page photos. */
export interface ExtractViewState {
  extractionId: string;
  running: boolean;
  pagesTotal: number;
  windowsTotal: number;
  windowsDone: number;
  questionsSoFar: number;
  failedWindows: number;
}

interface AgentUiBlocksProps {
  extract?: ExtractViewState | null;
  blocks: AgentUi[];
  interactive: boolean;
  busy: boolean;
  upload: UploadViewState;
  onChoice: (slot: string, value: string, label: string) => void;
  onSkip: () => void;
  onCancel: () => void;
  onConfirm: (token: string, confirmText?: string) => Promise<void>;
  onFile: (file: File) => void;
  onRetry: () => void;
}

export function AgentUiBlocks({
  extract,
  blocks,
  interactive,
  busy,
  upload,
  onChoice,
  onSkip,
  onCancel,
  onConfirm,
  onFile,
  onRetry,
}: AgentUiBlocksProps) {
  if (!blocks.length) return null;
  const disabled = !interactive || busy;

  return (
    <div className="agent-blocks">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'chips':
            return (
              <div key={index} className="agent-chips" role="group" aria-label="اختيارات سريعة">
                {block.options.map((option) => (
                  <button
                    key={option.value || option.label}
                    type="button"
                    className="agent-chip"
                    disabled={disabled}
                    onClick={() => onChoice(block.slot, option.value, option.label)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            );

          case 'upload':
            return (
              <UploadZone
                key={index}
                accept={block.accept}
                skippable={block.skippable}
                disabled={disabled}
                state={upload}
                onFile={onFile}
                onSkip={onSkip}
              />
            );

          case 'confirm':
            return (
              <ConfirmCard
                key={block.token}
                block={block}
                disabled={disabled}
                onConfirm={onConfirm}
                onEdit={(slot, label) => onChoice('__edit', slot, `تعديل: ${label}`)}
                onCancel={onCancel}
              />
            );

          case 'delete_confirm':
            return (
              <DeleteConfirmCard
                key={block.token}
                block={block}
                disabled={disabled}
                onConfirm={onConfirm}
                onCancel={onCancel}
              />
            );

          case 'success':
            return (
              <div key={index} className="agent-card agent-card-success" role="status">
                <div className="agent-card-head">
                  <CheckCircle2 size={20} aria-hidden="true" />
                  <strong>{block.title}</strong>
                </div>
                {block.lines.map((line) => (
                  <p key={line} className="agent-card-line">
                    {line}
                  </p>
                ))}
                {block.link && (
                  <Link href={block.link.href} className="agent-link-btn">
                    {block.link.label}
                  </Link>
                )}
              </div>
            );

          case 'error':
            return (
              <div key={index} className="agent-card agent-card-error" role="alert">
                <div className="agent-card-head">
                  <AlertTriangle size={20} aria-hidden="true" />
                  <strong>{block.message}</strong>
                </div>
                {block.retry && (
                  <button type="button" className="agent-btn agent-btn-outline" disabled={disabled} onClick={onRetry}>
                    <RotateCcw size={16} aria-hidden="true" /> إعادة المحاولة
                  </button>
                )}
              </div>
            );

          case 'pages_request':
            return (
              <div key={index} className="agent-card agent-card-pages" role="note">
                <div className="agent-card-head">
                  <ImagePlus size={20} aria-hidden="true" />
                  <strong>ارفع صور ورق الامتحان</strong>
                </div>
                <p className="agent-card-line">
                  استخدم زر المرفقات 📎 في الأسفل لاختيار صورة أو أكتر (JPG أو PNG أو WebP، حتى 10 ميجابايت للصورة). رتّبها بالترتيب الصحيح
                  قبل الإرسال.
                </p>
              </div>
            );

          case 'extract': {
            const state = extract && extract.extractionId === block.extractionId ? extract : null;
            const percent = state ? Math.round((state.windowsDone / Math.max(1, state.windowsTotal)) * 100) : 0;
            return (
              <div key={index} className="agent-card agent-card-extract" role="status" aria-live="polite">
                <div className="agent-card-head">
                  {state?.running ? (
                    <LoaderCircle size={20} className="spin" aria-hidden="true" />
                  ) : (
                    <FileSearch size={20} aria-hidden="true" />
                  )}
                  <strong>استخراج الأسئلة من الصور</strong>
                </div>
                <div
                  className="agent-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label="تقدم استخراج الأسئلة"
                >
                  <span style={{ width: percent + '%' }} />
                </div>
                <p className="agent-card-line">
                  {state
                    ? state.running
                      ? 'جاري معالجة الصفحات: ' +
                        Math.min(state.pagesTotal, Math.round((state.windowsDone / Math.max(1, state.windowsTotal)) * state.pagesTotal)) +
                        ' من ' +
                        state.pagesTotal +
                        ' — تم العثور على ' +
                        state.questionsSoFar +
                        ' سؤال حتى الآن'
                      : state.failedWindows > 0
                        ? 'انتهت المعالجة (فشلت ' + state.failedWindows + ' دفعة)'
                        : 'انتهت المعالجة'
                    : 'في الانتظار...'}
                </p>
              </div>
            );
          }

          case 'extraction_result':
            return (
              <section key={index} className="agent-card agent-card-result" aria-label="نتيجة الاستخراج">
                <div className="agent-card-head">
                  <CheckCircle2 size={20} aria-hidden="true" />
                  <strong>
                    تم استخراج {block.questionCount} سؤال من {block.pageCount} صفحة
                  </strong>
                </div>
                {block.invalidCount > 0 && (
                  <p className="agent-card-line">منها {block.invalidCount} سؤال بلا إجابة صحيحة محددة (هتتراجع قبل الحفظ).</p>
                )}
                {block.duplicatesRemoved > 0 && (
                  <p className="agent-card-line">تم حذف أو دمج {block.duplicatesRemoved} سؤال ظهر مرتين بين الصفحات.</p>
                )}
                {block.failedPages.length > 0 && (
                  <p className="agent-inline-error">صفحات فشلت: {block.failedPages.join('، ')}</p>
                )}
                {block.warnings.length > 0 && (
                  <ul className="agent-warning-list">
                    {block.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {block.preview.length > 0 && (
                  <ol className="agent-preview-list" aria-label="معاينة أول الأسئلة">
                    {block.preview.map((question) => (
                      <li key={question.number}>
                        <strong dir="auto">
                          {question.number}. {question.prompt}
                        </strong>
                        {question.options.length > 0 && (
                          <span dir="auto" className="agent-preview-options">
                            {question.options.join(' · ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                <Link href={block.reviewHref} className="agent-link-btn agent-link-btn-outline">
                  فتح شاشة المراجعة والتعديل الكاملة
                </Link>
              </section>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

// ── Delete confirmation card (type the exact name) ──────────────────────────────

function DeleteConfirmCard({
  block,
  disabled,
  onConfirm,
  onCancel,
}: {
  block: Extract<AgentUi, { kind: 'delete_confirm' }>;
  disabled: boolean;
  onConfirm: (token: string, confirmText?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'idle' | 'executing' | 'done' | 'failed'>('idle');
  const [error, setError] = useState('');

  // The button only unlocks on an exact match (the server checks the typed text again).
  const matches = typed.normalize('NFC').trim() === block.expectText.normalize('NFC').trim();
  const locked = disabled || state === 'executing' || state === 'done';
  const inputId = `delete-confirm-${block.token.slice(0, 12)}`;

  const handleConfirm = async () => {
    if (!matches || locked) return;
    setState('executing');
    setError('');
    try {
      await onConfirm(block.token, typed);
      setState('done');
    } catch (caught) {
      setState('failed');
      setError(caught instanceof Error ? caught.message : 'تعذر تنفيذ العملية.');
    }
  };

  return (
    <section className="agent-card agent-card-danger" aria-label={`حذف ${block.itemKind}`}>
      <div className="agent-card-head">
        <Trash2 size={20} aria-hidden="true" />
        <strong>
          حذف {block.itemKind} «<bdi>{block.name}</bdi>»
        </strong>
      </div>

      {block.rows.length > 0 ? (
        <>
          <p className="agent-card-line">اللي هيتمسح أو يتأثر:</p>
          <dl className="agent-rows">
            {block.rows.map((row) => (
              <div key={row.label} className="agent-row">
                <dt>{row.label}</dt>
                <dd>
                  <bdi className="agent-row-value">{row.value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="agent-card-line">مفيش بيانات مرتبطة بالعنصر ده.</p>
      )}

      {block.irreversible && (
        <p className="agent-danger-note" role="note">
          الحذف نهائي ولا يمكن التراجع عنه. صلاحية هذا التأكيد {Math.round(block.expiresInSec / 60)} دقائق فقط.
        </p>
      )}

      <label className="agent-danger-label" htmlFor={inputId}>
        اكتب الاسم بالضبط للتأكيد: <bdi className="agent-danger-name">{block.expectText}</bdi>
      </label>
      <input
        id={inputId}
        className="agent-danger-input"
        type="text"
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        disabled={locked}
        onChange={(event) => setTyped(event.target.value)}
        aria-invalid={typed.length > 0 && !matches}
      />

      {error && (
        <p className="agent-inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="agent-actions">
        <button
          type="button"
          className="agent-btn agent-btn-danger"
          disabled={!matches || locked}
          onClick={handleConfirm}
        >
          {state === 'executing' ? (
            <>
              <LoaderCircle size={16} className="spin" aria-hidden="true" /> جاري الحذف...
            </>
          ) : state === 'done' ? (
            <>
              <CheckCircle2 size={16} aria-hidden="true" /> تم
            </>
          ) : (
            'حذف نهائي'
          )}
        </button>
        <button type="button" className="agent-btn agent-btn-outline" disabled={locked} onClick={onCancel}>
          <X size={16} aria-hidden="true" /> إلغاء
        </button>
      </div>
    </section>
  );
}

// ── Confirmation card ───────────────────────────────────────────────────────────

function ConfirmCard({
  block,
  disabled,
  onConfirm,
  onEdit,
  onCancel,
}: {
  block: Extract<AgentUi, { kind: 'confirm' }>;
  disabled: boolean;
  onConfirm: (token: string) => Promise<void>;
  onEdit: (slot: string, label: string) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<'idle' | 'executing' | 'done' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const handleConfirm = async () => {
    if (state === 'executing' || state === 'done') return;
    setState('executing');
    setError('');
    try {
      await onConfirm(block.token);
      setState('done');
    } catch (caught) {
      setState('failed');
      setError(caught instanceof Error ? caught.message : 'تعذر تنفيذ العملية.');
    }
  };

  const locked = disabled || state === 'executing' || state === 'done';

  return (
    <section className="agent-card agent-card-confirm" aria-label={block.title}>
      <div className="agent-card-head">
        <strong>{block.title}</strong>
      </div>

      <dl className="agent-rows">
        {block.rows.map((row) => (
          <div key={row.label} className="agent-row">
            <dt>{row.label}</dt>
            <dd>
              {row.previous && <span className="agent-row-prev">{row.previous}</span>}
              {row.previous && <span aria-hidden="true"> ← </span>}
              <bdi className="agent-row-value">{row.value}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      {editing && !locked && (
        <div className="agent-chips" role="group" aria-label="اختر ما تريد تعديله">
          {block.editable.map((option) => (
            <button
              key={option.value}
              type="button"
              className="agent-chip"
              onClick={() => onEdit(option.value, option.label)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="agent-inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="agent-actions">
        <button type="button" className="agent-btn agent-btn-primary" disabled={locked} onClick={handleConfirm}>
          {state === 'executing' ? (
            <>
              <LoaderCircle size={16} className="spin" aria-hidden="true" /> جاري التنفيذ...
            </>
          ) : state === 'done' ? (
            <>
              <CheckCircle2 size={16} aria-hidden="true" /> تم التأكيد
            </>
          ) : (
            'تأكيد'
          )}
        </button>
        <button
          type="button"
          className="agent-btn agent-btn-outline"
          disabled={locked}
          aria-expanded={editing}
          onClick={() => setEditing((value) => !value)}
        >
          <Pencil size={16} aria-hidden="true" /> تعديل
        </button>
        <button type="button" className="agent-btn agent-btn-ghost" disabled={locked} onClick={onCancel}>
          <X size={16} aria-hidden="true" /> إلغاء
        </button>
      </div>
    </section>
  );
}

// ── Thumbnail upload zone ───────────────────────────────────────────────────────

function UploadZone({
  accept,
  skippable,
  disabled,
  state,
  onFile,
  onSkip,
}: {
  accept: string;
  skippable: boolean;
  disabled: boolean;
  state: UploadViewState;
  onFile: (file: File) => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = state.status === 'uploading';

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`agent-upload ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) pick(event.dataTransfer.files);
      }}
    >
      {state.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not optimizable
        <img className="agent-upload-preview" src={state.previewUrl} alt="معاينة الصورة المصغرة" />
      ) : (
        <ImagePlus size={28} aria-hidden="true" />
      )}

      <p className="agent-upload-text">
        {state.status === 'uploading'
          ? 'جاري رفع الصورة...'
          : state.status === 'done'
            ? `تم رفع الصورة${state.fileName ? `: ${state.fileName}` : ''}`
            : 'اسحب الصورة هنا أو اختارها من جهازك (JPG أو PNG أو WebP، حتى 5 ميجابايت)'}
      </p>

      {state.error && (
        <p className="agent-inline-error" role="alert">
          {state.error}
        </p>
      )}
      {state.note && <p className="agent-upload-note">{state.note}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="agent-visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = '';
        }}
      />
      <div className="agent-actions">
        <button
          type="button"
          className="agent-btn agent-btn-primary"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
          اختيار صورة
        </button>
        {skippable && (
          <button type="button" className="agent-btn agent-btn-ghost" disabled={disabled || busy} onClick={onSkip}>
            تخطي
          </button>
        )}
      </div>
    </div>
  );
}

/** Revokes preview blob URLs when the component using them unmounts. */
export function useRevokeOnUnmount(url?: string) {
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
}
