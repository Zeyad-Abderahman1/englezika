'use client';

/**
 * app/components/admin/shell/AdminMobileNav.tsx
 *
 * Responsive mobile navigation drawer / sheet with backdrop overlay.
 * Renders navigation items directly from the shared ADMIN_NAV_GROUPS config
 * (same source as the desktop AdminSidebar).
 * Closes after navigation, supports keyboard Escape, touch interactions,
 * and preserves permission filtering.
 *
 * Supports smooth enter/exit animations via CSS transitions.
 * The component stays mounted during the closing animation and unmounts
 * after the CSS transition completes.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ChevronDown, LogOut, X, ShieldCheck } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { ADMIN_NAV_GROUPS, isAdminNavItemActive } from './admin-navigation';

type DrawerState = { mounted: boolean; closing: boolean };
type DrawerAction =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'ANIMATION_END' };

function drawerReducer(state: DrawerState, action: DrawerAction): DrawerState {
  switch (action.type) {
    case 'OPEN':
      return { mounted: true, closing: false };
    case 'CLOSE':
      return state.closing ? state : { ...state, closing: true };
    case 'ANIMATION_END':
      return { mounted: false, closing: false };
    default:
      return state;
  }
}

export function AdminMobileNav() {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen, admin, counts, can, isTeacher } = useAdmin();
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const [state, dispatch] = useReducer(drawerReducer, {
    mounted: false,
    closing: false,
  });

  const isAnimatingOut = useRef(false);
  const [collapsedGroups, toggleGroup] = useReducer((state: Record<string, boolean>, href: string) => ({ ...state, [href]: !state[href] }), {});

  useEffect(() => {
    if (sidebarOpen) {
      isAnimatingOut.current = false;
      dispatch({ type: 'OPEN' });
    } else if (state.mounted) {
      isAnimatingOut.current = true;
      dispatch({ type: 'CLOSE' });
    }
  }, [sidebarOpen, state.mounted]);

  useEffect(() => {
    if (!sidebarOpen || !state.mounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen, state.mounted, setSidebarOpen]);

  const handleBackdropTransitionEnd = useCallback(() => {
    if (isAnimatingOut.current) {
      isAnimatingOut.current = false;
      dispatch({ type: 'ANIMATION_END' });
    }
  }, []);

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

  if (!state.mounted) return null;

  return (
    <div
      className={`admin-mobile-nav-container ${state.closing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="قائمة التنقل للموبايل"
    >
      <div
        ref={backdropRef}
        className={`admin-mobile-backdrop ${state.closing ? 'is-closing' : ''}`}
        onClick={handleClose}
        onTransitionEnd={handleBackdropTransitionEnd}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        className={`admin-mobile-drawer ${state.closing ? 'is-closing' : ''}`}
      >
        <header className="admin-mobile-drawer-header">
          <div className="admin-mobile-drawer-brand">
            <div className="admin-mobile-brand-icon" aria-hidden="true">
              <BookOpen size={18} />
            </div>
            <div className="admin-mobile-brand-meta">
              <span className="admin-mobile-brand-title">Englizeka</span>
              <span className="admin-mobile-brand-sub">لوحة الإدارة والمتابعة</span>
            </div>
          </div>
          <button
            type="button"
            className="admin-mobile-close-btn"
            onClick={handleClose}
            aria-label="إغلاق القائمة"
          >
            <X size={20} />
          </button>
        </header>

        {/* Teacher / Staff Profile Card */}
        <div className="admin-mobile-profile-card">
          <div className="admin-mobile-avatar" aria-hidden="true">
            {(admin?.name || 'A')[0].toUpperCase()}
          </div>
          <div className="admin-mobile-profile-info">
            <strong className="admin-mobile-profile-name">{admin?.name || 'Mr Ahmed Hassan'}</strong>
            <span className="admin-mobile-profile-role">
              <ShieldCheck size={12} />
              {isTeacher ? 'مدرس — صلاحية كاملة' : 'فريق العمل'}
            </span>
          </div>
        </div>

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
                    const visibleChildren = item.children?.filter((child) => !child.permission || can(child.permission));
                    const expanded = Boolean(visibleChildren?.length) && (isActive || !collapsedGroups[item.href]);
                    const count = item.badgeCount ? item.badgeCount(counts) : 0;
                    const staggerDelay = groupIdx * 30 + itemIdx * 25;

                    return (
                      <li key={item.href} className={visibleChildren?.length ? 'admin-mobile-nav-parent' : undefined}>
                        <div className="admin-mobile-nav-parent-row"><Link
                          href={item.href}
                          className={`admin-mobile-nav-item ${isActive ? 'active' : ''}`}
                          onClick={() => setSidebarOpen(false)}
                          aria-current={pathname === item.href ? 'page' : undefined}
                          style={{ '--stagger-delay': `${staggerDelay}ms` } as React.CSSProperties}
                        >
                          <span className="admin-mobile-nav-icon">
                            <Icon size={18} />
                          </span>
                          <span className="admin-mobile-nav-label">{item.label}</span>
                          {count > 0 && (
                            <span className="admin-mobile-nav-badge" aria-label={`${count} عناصر معلقة`}>
                              {count}
                            </span>
                          )}
                        </Link>{visibleChildren?.length ? <button type="button" className="admin-mobile-nav-expand" onClick={() => toggleGroup(item.href)} aria-expanded={expanded} aria-label={isActive ? `قسم ${item.label} موسع للمسار الحالي` : `${expanded ? 'طي' : 'توسيع'} قسم ${item.label}`} disabled={isActive}><ChevronDown size={16} /></button> : null}</div>
                        {visibleChildren?.length && expanded ? <ul className="admin-mobile-nav-children">{visibleChildren.map((child) => { const ChildIcon = child.icon; const childActive = isAdminNavItemActive(pathname, child.href); return <li key={child.href}><Link href={child.href} className={`admin-mobile-nav-child ${childActive ? 'active' : ''}`} onClick={handleClose} aria-current={childActive ? 'page' : undefined} style={{ '--stagger-delay': `${staggerDelay + 20}ms` } as React.CSSProperties}><ChildIcon size={16} /><span>{child.label}</span></Link></li>; })}</ul> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <footer className="admin-mobile-drawer-footer">
          <button
            type="button"
            className="admin-mobile-logout-btn"
            onClick={handleLogout}
            aria-label="تسجيل الخروج من المنصة"
          >
            <LogOut size={16} className="admin-logout-icon" />
            <span>تسجيل الخروج من النظام</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
