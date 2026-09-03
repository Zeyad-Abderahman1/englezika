'use client';

/**
 * app/components/admin/shell/AdminConfirmDialog.tsx
 *
 * Accessible confirmation dialog for destructive or high-impact actions.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

export function AdminConfirmDialog() {
  const { confirmDialog, closeConfirm, busy } = useAdmin();
  const [challengeInput, setChallengeInput] = useState('');

  useEffect(() => {
    setChallengeInput('');
  }, [confirmDialog.isOpen]);

  useEffect(() => {
    if (!confirmDialog.isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog.isOpen, closeConfirm]);

  if (!confirmDialog.isOpen) return null;

  const isMatchRequired = Boolean(confirmDialog.requireMatch);
  const isMatchValid = !isMatchRequired || challengeInput.trim() === confirmDialog.requireMatch;

  const handleConfirm = async () => {
    if (!isMatchValid) return;
    await confirmDialog.onConfirm();
    closeConfirm();
  };

  return (
    <div
      className="modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeConfirm();
      }}
    >
      <div className="admin-confirm-card">
        <header className="admin-confirm-header">
          <div className={`admin-confirm-icon ${confirmDialog.isDestructive !== false ? 'destructive' : ''}`}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <h3 id="confirm-dialog-title" className="admin-confirm-title">
              {confirmDialog.title}
            </h3>
            <p id="confirm-dialog-desc" className="admin-confirm-message">
              {confirmDialog.message}
            </p>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={closeConfirm}
            aria-label="إلغاء وإغلاق"
          >
            <X size={18} />
          </button>
        </header>

        {isMatchRequired && (
          <div
            className="admin-confirm-challenge-box"
            style={{
              margin: '14px 0',
              padding: '12px 14px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '8px',
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: '#f87171', fontWeight: 600 }}>
              اكتب <strong style={{ color: '#fff' }}>{confirmDialog.requireMatch}</strong> للتأكيد:
            </p>
            <input
              type="text"
              className="form-control"
              value={challengeInput}
              onChange={(e) => setChallengeInput(e.target.value)}
              placeholder={confirmDialog.requireMatch}
              dir="ltr"
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: '#0d0f14',
                color: '#fff',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                fontWeight: 700,
                letterSpacing: '1px',
                textAlign: 'center',
              }}
            />
          </div>
        )}

        <footer className="admin-confirm-footer">
          <button
            type="button"
            className="btn btn-outline"
            onClick={closeConfirm}
            disabled={busy}
          >
            {confirmDialog.cancelLabel || 'إلغاء'}
          </button>
          <button
            type="button"
            className={`btn ${confirmDialog.isDestructive !== false ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={busy || !isMatchValid}
          >
            {confirmDialog.isDestructive !== false ? <Trash2 size={16} /> : null}
            {confirmDialog.confirmLabel || 'تأكيد الحذف'}
          </button>
        </footer>
      </div>
    </div>
  );
}
