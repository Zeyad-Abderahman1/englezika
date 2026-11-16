'use client';

/**
 * app/components/admin/shell/AdminErrorState.tsx
 *
 * Polished Arabic error display with retry button.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface AdminErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function AdminErrorState({
  title = 'حدث خطأ أثناء تحميل البيانات',
  message,
  onRetry,
}: AdminErrorStateProps) {
  return (
    <div className="admin-error-state" role="alert">
      <div className="admin-error-icon">
        <AlertTriangle size={32} />
      </div>
      <div className="admin-error-body">
        <h3 className="admin-error-title">{title}</h3>
        <p className="admin-error-message">{message}</p>
        {onRetry && (
          <button type="button" className="btn btn-outline admin-error-retry" onClick={onRetry}>
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        )}
      </div>
    </div>
  );
}
