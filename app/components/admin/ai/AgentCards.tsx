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

interface AgentUiBlocksProps {
  blocks: AgentUi[];
  interactive: boolean;
  busy: boolean;
  upload: UploadViewState;
  onChoice: (slot: string, value: string, label: string) => void;
  onSkip: () => void;
  onCancel: () => void;
  onConfirm: (token: string) => Promise<void>;
  onFile: (file: File) => void;
  onRetry: () => void;
}

export function AgentUiBlocks({
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

          default:
            return null;
        }
      })}
    </div>
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
