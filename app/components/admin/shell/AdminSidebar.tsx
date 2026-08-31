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
import {
  BarChart3,
  BellRing,
  BookOpen,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Mail,
  PlaySquare,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import type { StaffPermission } from '../../../lib/staff-permissions';

export type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: StaffPermission;
  badgeCount?: (counts: ReturnType<typeof useAdmin>['counts']) => number;
  teacherOnly?: boolean;
};

export type NavGroup = {
  group: string;
  items: NavItem[];
};

export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    group: 'الرئيسية',
    items: [
      {
        label: 'نظرة عامة',
        href: '/admin',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    group: 'المحتوى التعليمي',
    items: [
      {
        label: 'الكورسات',
        href: '/admin/courses',
        icon: BookOpen,
        permission: 'manage_courses',
      },
      {
        label: 'المحاضرات',
        href: '/admin/lectures',
        icon: PlaySquare,
        permission: 'manage_videos',
      },
      {
        label: 'الامتحانات',
        href: '/admin/exams',
        icon: FileQuestion,
        permission: 'manage_exams',
      },
      {
        label: 'الواجبات',
        href: '/admin/assignments',
        icon: ClipboardCheck,
        permission: 'manage_assignments',
      },
    ],
  },
  {
    group: 'الطلاب والمتابعة',
    items: [
      {
        label: 'الطلاب',
        href: '/admin/students',
        icon: GraduationCap,
        permission: 'view_students',
      },
      {
        label: 'الاشتراكات',
        href: '/admin/enrollments',
        icon: Users,
        permission: 'manage_enrollments',
        badgeCount: (c) => c.pendingEnrollments,
      },
      {
        label: 'النتائج والتصحيح',
        href: '/admin/results',
        icon: BarChart3,
        permission: 'grade_exams',
      },
    ],
  },
  {
    group: 'التواصل',
    items: [
      {
        label: 'الإعلانات',
        href: '/admin/announcements',
        icon: BellRing,
        permission: 'manage_announcements',
      },
      {
        label: 'الرسائل',
        href: '/admin/messages',
        icon: Mail,
        permission: 'manage_messages',
        badgeCount: (c) => c.newMessages,
      },
    ],
  },
  {
    group: 'إدارة النظام',
    items: [
      {
        label: 'حسابات الفريق',
        href: '/admin/staff',
        icon: UserCog,
        permission: 'manage_staff',
        teacherOnly: true,
      },
    ],
  },
];

export function AdminSidebar({ onItemClick }: { onItemClick?: () => void }) {
  const pathname = usePathname();
  const { admin, counts, can, isTeacher } = useAdmin();

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
                  const isActive =
                    item.href === '/admin'
                      ? pathname === '/admin'
                      : pathname.startsWith(item.href);
                  const count = item.badgeCount ? item.badgeCount(counts) : 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`admin-nav-item ${isActive ? 'active' : ''}`}
                        onClick={onItemClick}
                        aria-current={isActive ? 'page' : undefined}
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
                      </Link>
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
