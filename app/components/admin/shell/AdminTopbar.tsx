'use client';

/**
 * app/components/admin/shell/AdminTopbar.tsx
 *
 * Sticky topbar for the admin application containing page contextual identity,
 * theme toggle, manual data refresh, user role indicator, and mobile drawer trigger.
 */

import { Menu, MoonStar, RefreshCw, Sun, ShieldCheck } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

interface AdminTopbarProps {
  title?: string;
}

export function AdminTopbar({ title }: AdminTopbarProps) {
  const { admin, isTeacher, light, toggleTheme, refreshData, busy, setSidebarOpen } = useAdmin();

  const roleLabel = isTeacher ? 'مدرس — صلاحية كاملة' : 'مساعد';

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-start">
        <button
          type="button"
          className="admin-hamburger-btn"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label="فتح القائمة الجانبية"
        >
          <Menu size={20} />
        </button>

        {title && (
          <div className="admin-topbar-page-identity">
            <span className="admin-topbar-subtitle">لوحة إدارة المنصة</span>
            <h2 className="admin-topbar-title">{title}</h2>
          </div>
        )}
      </div>

      <div className="admin-topbar-end">
        {/* Role & User indicator */}
        <div className="admin-topbar-user">
          <span className="admin-topbar-user-icon">
            <ShieldCheck size={16} />
          </span>
          <div className="admin-topbar-user-text">
            <strong className="admin-topbar-user-name">{admin?.name || 'المستخدم'}</strong>
            <small className="admin-topbar-user-role">{roleLabel}</small>
          </div>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          className="btn btn-ghost admin-topbar-action-btn"
          onClick={() => void refreshData(1)}
          disabled={busy}
          title="تحديث البيانات"
          aria-label="تحديث البيانات"
        >
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          <span className="admin-btn-text">تحديث</span>
        </button>

        {/* Theme Toggle */}
        <button
          type="button"
          className={`theme-toggle ${light ? 'is-light' : 'is-dark'}`}
          onClick={toggleTheme}
          aria-pressed={light}
          aria-label={light ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
        >
          <span className="theme-thumb" aria-hidden="true" />
          <span className="theme-icon theme-moon" aria-hidden="true">
            <MoonStar size={16} />
          </span>
          <span className="theme-icon theme-sun" aria-hidden="true">
            <Sun size={17} />
          </span>
        </button>
      </div>
    </header>
  );
}
