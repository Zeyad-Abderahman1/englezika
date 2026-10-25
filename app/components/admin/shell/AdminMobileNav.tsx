'use client';

/**
 * app/components/admin/shell/AdminMobileNav.tsx
 *
 * Responsive RTL mobile navigation drawer / sheet with backdrop overlay.
 * Renders navigation items directly from the shared ADMIN_NAV_GROUPS config
 * (same source as the desktop AdminSidebar).
 *
 * The drawer is always mounted so CSS can animate both opening and closing.
 * It slides in from the right edge (RTL start), locks body scrolling while
 * open, closes on Escape/backdrop/route change, and restores scrolling.
 */

import { useCallback, useEffect, useReducer } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, X, ShieldCheck } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { ADMIN_NAV_GROUPS, isAdminNavItemActive } from './admin-navigation';

export function AdminMobileNav() {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen, admin, counts, can, isTeacher } = useAdmin();
  const [collapsedGroups, toggleGroup] = useReducer(
    (state: Record<string, boolean>, href: string) => ({ ...state, [href]: !state[href] }),
    {}
  );

  // Close the drawer whenever navigation changes the current route.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  // Lock page scrolling while the drawer is open and restore it on close/unmount.
  useEffect(() => {
    if (!sidebarOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen, setSidebarOpen]);

  // Never leave a stale scroll lock if the viewport becomes desktop-sized.
  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setSidebarOpen(false);
    };

    desktopQuery.addEventListener('change', handleViewportChange);
    return () => desktopQuery.removeEventListener('change', handleViewportChange);
  }, [setSidebarOpen]);

  const handleClose = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/staff/logout', { method: 'POST' });
    } finally {
      window.location.assign('/staff/login');
    }
  };

  return (
    <div
      className={`admin-mobile-nav-container ${sidebarOpen ? 'is-open' : ''}`}
      aria-hidden={!sidebarOpen}
    >
      <div
        className={`admin-mobile-backdrop ${sidebarOpen ? 'is-open' : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className={`admin-mobile-drawer ${sidebarOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal={sidebarOpen}
        aria-label="قائمة التنقل للموبايل"
      >
        <header className="admin-mobile-drawer-header">
          <span className="admin-mobile-drawer-title">قائمة الإدارة</span>
          <button
            type="button"
            className="admin-mobile-close-btn"
            onClick={handleClose}
            aria-label="إغلاق القائمة"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="admin-mobile-nav-body" aria-label="أقسام الإدارة">
          {ADMIN_NAV_GROUPS.map((group, groupIdx) => {
            const visibleItems = group.items.filter((item) => {
              if (item.teacherOnly && !isTeacher) return false;
              if (item.permission && !can(item.permission)) return false;
              return true;
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.group} className="admin-mobile-nav-group">
                <span className="admin-mobile-nav-group-title">{group.group}</span>
                <ul className="admin-mobile-nav-list">
                  {visibleItems.map((item, itemIdx) => {
                    const Icon = item.icon;
                    const isActive = isAdminNavItemActive(pathname, item.href);
                    const visibleChildren = item.children?.filter(
                      (child) => !child.permission || can(child.permission)
                    );
                    const expanded =
                      Boolean(visibleChildren?.length) &&
                      (isActive || !collapsedGroups[item.href]);
                    const count = item.badgeCount ? item.badgeCount(counts) : 0;
                    const staggerDelay = groupIdx * 30 + itemIdx * 25;

                    return (
                      <li
                        key={item.href}
                        className={visibleChildren?.length ? 'admin-mobile-nav-parent' : undefined}
                      >
                        <div className="admin-mobile-nav-parent-row">
                          <Link
                            href={item.href}
                            className={`admin-mobile-nav-item ${isActive ? 'active' : ''}`}
                            onClick={handleClose}
                            aria-current={pathname === item.href ? 'page' : undefined}
                            style={{ '--stagger-delay': `${staggerDelay}ms` } as React.CSSProperties}
                          >
                            <span className="admin-mobile-nav-icon">
                              <Icon size={18} />
                            </span>
                            <span className="admin-mobile-nav-label">{item.label}</span>
                            {count > 0 && (
                              <span
                                className="admin-mobile-nav-badge"
                                aria-label={`${count} عناصر معلقة`}
                              >
                                {count}
                              </span>
                            )}
                          </Link>
                          {visibleChildren?.length ? (
                            <button
                              type="button"
                              className="admin-mobile-nav-expand"
                              onClick={() => toggleGroup(item.href)}
                              aria-expanded={expanded}
                              aria-label={
                                isActive
                                  ? `قسم ${item.label} موسع للمسار الحالي`
                                  : `${expanded ? 'طي' : 'توسيع'} قسم ${item.label}`
                              }
                              disabled={isActive}
                            >
                              <ChevronDown size={16} />
                            </button>
                          ) : null}
                        </div>
                        {visibleChildren?.length && expanded ? (
                          <ul className="admin-mobile-nav-children">
                            {visibleChildren.map((child) => {
                              const ChildIcon = child.icon;
                              const childActive = isAdminNavItemActive(pathname, child.href);
                              return (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    className={`admin-mobile-nav-child ${childActive ? 'active' : ''}`}
                                    onClick={handleClose}
                                    aria-current={childActive ? 'page' : undefined}
                                    style={
                                      {
                                        '--stagger-delay': `${staggerDelay + 20}ms`,
                                      } as React.CSSProperties
                                    }
                                  >
                                    <ChildIcon size={16} />
                                    <span>{child.label}</span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <footer className="admin-mobile-drawer-footer">
          <div className="admin-mobile-user-info">
            <span className="admin-mobile-user-icon">
              <ShieldCheck size={14} />
            </span>
            <span className="admin-mobile-user-name">{admin?.name || 'المستخدم'}</span>
          </div>
          <button
            type="button"
            className="admin-mobile-logout-btn"
            onClick={handleLogout}
            aria-label="تسجيل الخروج"
          >
            <LogOut size={16} />
            <span>تسجيل الخروج</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
