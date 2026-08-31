'use client';

/**
 * app/components/admin/shell/AdminConfirmDialog.tsx
 *
 * Accessible confirmation dialog for destructive or high-impact actions.
 */

import { useEffect } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

export function AdminConfirmDialog() {
  const { confirmDialog, closeConfirm, busy } = useAdmin();

  useEffect(() => {
    if (!confirmDialog.isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog.isOpen, closeConfirm]);

  if (!confirmDialog.isOpen) return null;

  const handleConfirm = async () => {
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
            disabled={busy}
          >
            {confirmDialog.isDestructive !== false ? <Trash2 size={16} /> : null}
            {confirmDialog.confirmLabel || 'تأكيد الحذف'}
          </button>
        </footer>
      </div>
    </div>
  );
}
