'use client';

/**
 * app/components/admin/shell/AdminMobileDock.tsx
 *
 * Floating rounded pill dock for the mobile admin experience.
 *
 * Renders five permission-aware quick actions fixed to the bottom center of
 * the viewport (below the `md` breakpoint). The center slot is the primary
 * crimson action that opens the AI OCR exam creator on `/admin/exams?action=ocr`.
 *
 * The dock is hidden on tablets/desktop, where the persistent sidebar is used,
 * and is suppressed while the full navigation drawer is open.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, FileCheck, GraduationCap, Sparkles, Video, type LucideIcon } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import type { StaffPermission } from '../../../lib/staff-permissions';
import { ADMIN_OPEN_OCR_EVENT } from './admin-navigation';

type DockItem = {
  slot: number;
  label: string;
  href: string;
  icon: LucideIcon;
  permission: StaffPermission;
  primary?: boolean;
};

const DOCK_ITEMS: DockItem[] = [
  {
    slot: 1,
    label: 'الكورسات',
    href: '/admin/courses',
    icon: BookOpen,
    permission: 'manage_courses',
  },
  {
    slot: 2,
    label: 'المحاضرات',
    href: '/admin/lectures',
    icon: Video,
    permission: 'manage_videos',
  },
  {
    slot: 3,
    label: 'اختبار OCR',
    href: '/admin/exams?action=ocr',
    icon: Sparkles,
    permission: 'manage_exams',
    primary: true,
  },
  {
    slot: 4,
    label: 'الامتحانات',
    href: '/admin/exams',
    icon: FileCheck,
    permission: 'manage_exams',
  },
  {
    slot: 5,
    label: 'الطلاب',
    href: '/admin/students',
    icon: GraduationCap,
    permission: 'view_students',
  },
];

export function AdminMobileDock() {
  const pathname = usePathname();
  const { can, sidebarOpen } = useAdmin();

  // The drawer renders above the dock; hiding the dock avoids duplicate
  // navigation targets while the modal drawer is open.
  if (sidebarOpen) return null;

  const visibleItems = DOCK_ITEMS.filter((item) => can(item.permission));
  if (visibleItems.length === 0) return null;

  const isItemActive = (item: DockItem) => {
    if (item.primary) return false;
    const baseHref = item.href.split('?')[0];
    if (baseHref === '/admin') return pathname === baseHref;
    return pathname === baseHref || pathname.startsWith(`${baseHref}/`);
  };

  const handleItemClick = (item: DockItem) => {
    // When the user is already on the exams page the query string may not
    // change (or Next may skip the navigation), so notify the mounted page.
    if (item.primary && pathname === '/admin/exams' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_OPEN_OCR_EVENT));
    }
  };

  return (
    <nav className="admin-mobile-dock" dir="rtl" aria-label="التنقل السريع للوحة الإدارة">
      <ul className="admin-mobile-dock-list">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item);
          const className = [
            'admin-mobile-dock-item',
            item.primary ? 'is-primary' : '',
            active ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={item.slot}>
              <Link
                href={item.href}
                className={className}
                onClick={() => handleItemClick(item)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
              >
                <span className="admin-mobile-dock-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={2.1} />
                </span>
                <span className="admin-mobile-dock-label">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
