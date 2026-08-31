'use client';

/**
 * app/components/admin/shell/AdminShell.tsx
 *
 * Master shell layout orchestrator for the multi-page Englizeka admin portal.
 * Assembles desktop persistent left sidebar, responsive mobile navigation drawer,
 * sticky topbar, global notification banners, prompt modals, and confirm dialogs.
 */

import { type ReactNode } from 'react';
import { Check, X, LoaderCircle } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';
import { AdminMobileNav } from './AdminMobileNav';
import { AdminPromptModal } from './AdminPromptModal';
import { AdminConfirmDialog } from './AdminConfirmDialog';

interface AdminShellProps {
  children: ReactNode;
  pageTitle?: string;
}

export function AdminShell({ children, pageTitle }: AdminShellProps) {
  const { notice, error, setNotice, setError, loading } = useAdmin();

  if (loading) {
    return (
      <div className="admin-initial-loading">
        <div className="admin-initial-loading-card">
          <LoaderCircle size={32} className="spin" />
          <p>جاري تحميل لوحة الإدارة والمصادقة...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-app-layout">
      {/* ── Desktop Left Persistent Sidebar ─────────────────────────────────── */}
      <div className="admin-desktop-sidebar-container">
        <AdminSidebar />
      </div>

      {/* ── Mobile Navigation Drawer ────────────────────────────────────────── */}
      <AdminMobileNav />

      {/* ── Main Content Area ───────────────────────────────────────────────── */}
      <div className="admin-main-container">
        {/* Topbar */}
        <AdminTopbar title={pageTitle} />

        {/* Global Toast Notices */}
        {notice && (
          <div className="admin-toast success-toast" role="status" aria-live="polite">
            <Check size={16} />
            <span>{notice}</span>
            <button
              type="button"
              className="admin-toast-dismiss"
              onClick={() => setNotice('')}
              aria-label="إغلاق التنبيه"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {error && (
          <div className="admin-toast error-toast" role="alert" aria-live="assertive">
            <X size={16} />
            <span>{error}</span>
            <button
              type="button"
              className="admin-toast-dismiss"
              onClick={() => setError('')}
              aria-label="إغلاق التنبيه"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Page Content */}
        <main className="admin-content-body" id="admin-main-content">
          {children}
        </main>
      </div>

      {/* ── Global Dynamic Modals ────────────────────────────────────────────── */}
      <AdminPromptModal />
      <AdminConfirmDialog />
    </div>
  );
}
