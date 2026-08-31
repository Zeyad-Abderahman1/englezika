'use client';

/**
 * app/components/admin/shell/AdminPromptModal.tsx
 *
 * Universal dynamic modal form for field editing and prompt actions.
 */

import { FormEvent, useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

export function AdminPromptModal() {
  const { promptModal, closePrompt, busy } = useAdmin();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!promptModal.isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePrompt();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [promptModal.isOpen, closePrompt]);

  if (!promptModal.isOpen) return null;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    promptModal.fields.forEach((field) => {
      values[field.name] = (fd.get(field.name) as string) || '';
    });
    promptModal.onSubmit(values);
    closePrompt();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePrompt();
      }}
    >
      <div className="admin-modal-card">
        <header className="admin-modal-header">
          <h3 id="prompt-modal-title" className="admin-modal-title">
            {promptModal.title}
          </h3>
          <button
            type="button"
            className="admin-modal-close"
            onClick={closePrompt}
            aria-label="إغلاق النافذة"
          >
            <X size={18} />
          </button>
        </header>

        <form ref={formRef} className="admin-modal-form stack-form" onSubmit={handleSubmit}>
          {promptModal.fields.map((field) => (
            <label key={field.name} className="admin-field-label">
              <span>
                {field.label} {field.required !== false && <span className="text-danger">*</span>}
              </span>
              <input
                name={field.name}
                type={field.type || 'text'}
                defaultValue={field.defaultValue || ''}
                required={field.required !== false}
                className="admin-input"
              />
            </label>
          ))}

          <footer className="admin-modal-footer">
            <button
              type="button"
              className="btn btn-outline"
              onClick={closePrompt}
              disabled={busy}
            >
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Save size={16} /> حفظ التعديلات
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
