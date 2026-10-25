'use client';

/**
 * app/components/admin/shell/AdminTopbar.tsx
 *
 * Sticky topbar for the admin application containing page contextual identity,
 * theme toggle, manual data refresh, user role indicator, and mobile drawer trigger.
 *
 * Mobile is a single compact 56px row: [hamburger] [brand + admin title] … [user badge].
 * The refresh/theme controls stay on desktop so the phone bar never collapses into
 * stacked or empty icon boxes.
 */

import { Menu, MoonStar, RefreshCw, ShieldCheck, Sun } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

interface AdminTopbarProps {
  title?: string;
}

export function AdminTopbar({ title }: AdminTopbarProps) {
  const { light, toggleTheme, refreshData, busy, setSidebarOpen, admin } = useAdmin();

  const displayName = admin?.name?.trim() || 'المشرف';
  const roleLabel = admin?.role === 'teacher' ? 'مدرس' : 'مساعد';
  const initial = displayName.charAt(0);

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

        <div className="admin-topbar-page-identity">
          <span className="admin-topbar-brand-mark" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <div className="admin-topbar-heading">
            <span className="admin-topbar-subtitle">لوحة إدارة المنصة</span>
            <h2 className="admin-topbar-title">{title || 'لوحة الإدارة'}</h2>
          </div>
        </div>
      </div>

      <div className="admin-topbar-end">
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

        <div
          className="admin-topbar-user"
          title={displayName}
          aria-label={`المستخدم الحالي: ${displayName} — ${roleLabel}`}
        >
          <span className="admin-topbar-user-icon" aria-hidden="true">
            <ShieldCheck size={14} />
          </span>
          <span className="admin-topbar-user-text">
            <span className="admin-topbar-user-name">{displayName}</span>
            <span className="admin-topbar-user-role">{roleLabel}</span>
          </span>
          <span className="admin-topbar-user-initial" aria-hidden="true">
            {initial}
          </span>
        </div>
      </div>
    </header>
  );
}
