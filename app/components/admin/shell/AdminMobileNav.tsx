'use client';

/**
 * app/components/admin/shell/AdminMobileNav.tsx
 *
 * Responsive mobile navigation drawer / sheet with backdrop overlay.
 * Closes after navigation, supports keyboard Escape, touch interactions,
 * and preserves permission filtering.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { AdminSidebar } from './AdminSidebar';

export function AdminMobileNav() {
  const { sidebarOpen, setSidebarOpen } = useAdmin();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sidebarOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };

    // Lock body scroll while mobile drawer is open
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen, setSidebarOpen]);

  if (!sidebarOpen) return null;

  return (
    <div
      className="admin-mobile-nav-container"
      role="dialog"
      aria-modal="true"
      aria-label="قائمة التنقل للموبايل"
    >
      {/* ── Backdrop overlay ─────────────────────────────────────────────────── */}
      <div
        className="admin-mobile-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Slide-in Drawer ─────────────────────────────────────────────────── */}
      <div ref={drawerRef} className="admin-mobile-drawer">
        <header className="admin-mobile-drawer-header">
          <span className="admin-mobile-drawer-title">قائمة الإدارة</span>
          <button
            type="button"
            className="admin-mobile-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="إغلاق القائمة"
          >
            <X size={20} />
          </button>
        </header>

        <div className="admin-mobile-drawer-content">
          <AdminSidebar onItemClick={() => setSidebarOpen(false)} />
        </div>
      </div>
    </div>
  );
}
