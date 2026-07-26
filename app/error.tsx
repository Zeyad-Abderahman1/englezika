'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureException } from './lib/observability';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { module: 'global-error-page' });
  }, [error]);

  return (
    <div
      className="error-page-container"
      dir="rtl"
      style={{
        minHeight: '70vh',
        display: 'grid',
        placeItems: 'center',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          padding: '36px',
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: '20px',
        }}
      >
        <div
          style={{
            width: '60px',
            height: '60px',
            margin: '0 auto 16px',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(207,11,39,0.14)',
            color: 'var(--red-bright)',
            borderRadius: '18px',
          }}
        >
          <AlertTriangle size={32} />
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: '800', margin: '0 0 10px' }}>
          حدث خطأ أثناء تحميل الصفحة
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 24px' }}>
          نأسف لذلك. تم تسجيل الخطأ تلقائياً. اضغط على الزر أدناه لإعادة المحاولة.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={() => reset()}
          style={{
            width: '100%',
            display: 'inline-flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <RefreshCw size={18} /> إعادة تحميل الصفحة
        </button>
      </div>
    </div>
  );
}
