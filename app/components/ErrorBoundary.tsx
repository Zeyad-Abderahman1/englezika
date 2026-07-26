'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureException } from '../lib/observability';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureException(error, {
      module: 'frontend-error-boundary',
      componentStack: errorInfo.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="error-boundary-card"
          dir="rtl"
          style={{
            padding: '40px 24px',
            margin: '40px auto',
            maxWidth: '500px',
            textAlign: 'center',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: '20px',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              margin: '0 auto 16px',
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(207,11,39,0.14)',
              color: 'var(--red-bright)',
              borderRadius: '16px',
            }}
          >
            <AlertTriangle size={28} />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', margin: '0 0 8px' }}>
            حدث خطأ غير متوقع
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 20px' }}>
            نأسف لذلك. يمكنك إعادة محاولة تحميل الصفحة أو التواصل مع الدعم الفني.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={this.handleRetry}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCw size={16} /> إعادة المحاولة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
