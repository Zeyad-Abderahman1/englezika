'use client';

/**
 * app/components/admin/shell/AdminSidebar.tsx
 *
 * Persistent desktop navigation sidebar positioned on the LEFT side of the desktop viewport.
 * Fully permission-aware: renders only authorized task groups and pages.
 * Supports pending badges, role indicator, and quick logout.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAdmin } from '../../../lib/admin-context';
import { ADMIN_NAV_GROUPS, isAdminNavItemActive } from './admin-navigation';

export { ADMIN_NAV_GROUPS };

export function AdminSidebar({ onItemClick }: { onItemClick?: () => void }) {
  const pathname = usePathname();
  const { admin, counts, can, isTeacher } = useAdmin();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const handleLogout = async () => {
    try {
      await fetch('/api/staff/logout', { method: 'POST' });
    } finally {
      window.location.assign('/staff/login');
    }
  };

  const roleBadgeLabel = isTeacher
    ? 'مدرس — صلاحية كاملة'
    : 'مساعد';

  return (
    <aside className="admin-sidebar" aria-label="شريط التنقل الجانبي">
      {/* ── Brand / Staff identity ────────────────────────────────────────── */}
      <div className="admin-sidebar-header">
        <Link href="/admin" className="admin-sidebar-brand" onClick={onItemClick}>
          <span className="admin-brand-icon">
            <ShieldCheck size={24} />
          </span>
          <div className="admin-brand-info">
            <strong className="admin-brand-name">{admin?.name || 'لوحة الإدارة'}</strong>
            <span className="admin-brand-role">{roleBadgeLabel}</span>
          </div>
        </Link>
      </div>

      {/* ── Navigation groups ─────────────────────────────────────────────── */}
      <nav className="admin-sidebar-nav" aria-label="أقسام الإدارة">
        {ADMIN_NAV_GROUPS.map((group) => {
          // Filter items based on actual resolved permissions
          const visibleItems = group.items.filter((item) => {
            if (item.teacherOnly && !isTeacher) return false;
            if (item.permission && !can(item.permission)) return false;
            return true;
          });

          if (visibleItems.length === 0) return null;

          return (
            <div key={group.group} className="admin-nav-group">
              <span className="admin-nav-group-title">{group.group}</span>
              <ul className="admin-nav-list">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isAdminNavItemActive(pathname, item.href);
                  const visibleChildren = item.children?.filter((child) => !child.permission || can(child.permission));
                  const expanded = Boolean(visibleChildren?.length) && (isActive || !collapsedGroups[item.href]);
                  const count = item.badgeCount ? item.badgeCount(counts) : 0;

                  return (
                    <li key={item.href} className={visibleChildren?.length ? 'admin-nav-parent' : undefined}>
                      <div className="admin-nav-parent-row"><Link
                        href={item.href}
                        className={`admin-nav-item ${isActive ? 'active' : ''}`}
                        onClick={onItemClick}
                        aria-current={pathname === item.href ? 'page' : undefined}
                      >
                        <span className="admin-nav-icon">
                          <Icon size={18} />
                        </span>
                        <span className="admin-nav-label">{item.label}</span>
                        {count > 0 && (
                          <span className="admin-nav-badge" aria-label={`${count} عناصر معلقة`}>
                            {count}
                          </span>
                        )}
                      </Link>{visibleChildren?.length ? <button type="button" className="admin-nav-expand" onClick={() => setCollapsedGroups((current) => ({ ...current, [item.href]: expanded }))} aria-expanded={expanded} aria-label={isActive ? `قسم ${item.label} موسع للمسار الحالي` : `${expanded ? 'طي' : 'توسيع'} قسم ${item.label}`} disabled={isActive}><ChevronDown size={15} /></button> : null}</div>
                      {visibleChildren?.length && expanded ? <ul className="admin-nav-children">{visibleChildren.map((child) => { const ChildIcon = child.icon; const childActive = isAdminNavItemActive(pathname, child.href); return <li key={child.href}><Link href={child.href} className={`admin-nav-child ${childActive ? 'active' : ''}`} onClick={onItemClick} aria-current={childActive ? 'page' : undefined}><ChildIcon size={15} /><span>{child.label}</span></Link></li>; })}</ul> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── Sidebar Footer / User / Logout ───────────────────────────────── */}
      <div className="admin-sidebar-footer">
        <div className="admin-user-pill">
          <span className="admin-user-email" title={admin?.email}>
            {admin?.email}
          </span>
        </div>
        <button
          type="button"
          className="admin-logout-btn"
          onClick={handleLogout}
          aria-label="تسجيل الخروج من لوحة الإدارة"
        >
          <LogOut size={16} />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
}
