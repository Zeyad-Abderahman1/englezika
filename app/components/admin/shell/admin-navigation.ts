/**
 * app/components/admin/shell/admin-navigation.ts
 *
 * Single authoritative source for admin navigation structure.
 * Both AdminSidebar (desktop) and AdminMobileNav (mobile) consume this config.
 * Permission filtering happens at render time — this file only declares structure.
 */

import {
  BarChart3,
  BellRing,
  BookOpen,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  Mail,
  PlaySquare,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import type { StaffPermission } from '../../../lib/staff-permissions';

export type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: StaffPermission;
  badgeCount?: (counts: { pendingEnrollments: number; newMessages: number }) => number;
  teacherOnly?: boolean;
  children?: NavItem[];
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
      {
        label: 'الذكاء الاصطناعي',
        href: '/admin/ai',
        icon: Sparkles,
        permission: 'manage_courses',
        children: [
          { label: 'المساعد الذكي', href: '/admin/ai/assistant', icon: Sparkles, permission: 'manage_courses' },
          { label: 'مولد الاختبارات من PDF', href: '/admin/ai/pdf-exam', icon: FileQuestion, permission: 'manage_courses' },
        ],
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

export const BRAND_ICON = ShieldCheck;

export function isAdminNavItemActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
