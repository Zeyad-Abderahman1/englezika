'use client';

/**
 * app/components/admin/shell/AdminBottomNav.tsx
 *
 * Native fixed Bottom Navigation Bar for mobile admin viewports (<= 767px).
 * Provides one-thumb reach to Englizeka core modules:
 * 1. نظرة عامة (Overview / Dashboard)
 * 2. الكورسات (Courses & Lectures)
 * 3. الامتحانات (Exams & Quizzes)
 * 4. المساعد (AI Tools Hub)
 * 5. المزيد (Opens Mobile Navigation Drawer)
 *
 * Hidden completely on desktop & tablet (>= 768px).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, BookOpen, GraduationCap, Sparkles, Menu } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';

export function AdminBottomNav() {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen, counts } = useAdmin();

  const isOverview = pathname === '/admin';
  const isCourses =
    pathname.startsWith('/admin/courses') ||
    pathname.startsWith('/admin/lectures') ||
    pathname.startsWith('/admin/assignments');
  const isExams =
    pathname.startsWith('/admin/exams') ||
    pathname.startsWith('/admin/results');
  const isAI = pathname.startsWith('/admin/ai');
  const isOther = !isOverview && !isCourses && !isExams && !isAI;
  const isMoreActive = sidebarOpen || isOther;

  const totalPending =
    (counts?.pendingEnrollments || 0) + (counts?.newMessages || 0);

  return (
    <nav
      className="admin-bottom-nav"
      style={{ display: 'none' }}
      aria-label="شريط التنقل السفلي للهاتف"
      dir="rtl"
    >
      <Link
        href="/admin"
        className={`admin-bottom-nav-item ${isOverview && !sidebarOpen ? 'active' : ''}`}
        aria-current={isOverview && !sidebarOpen ? 'page' : undefined}
      >
        <span className="admin-bottom-nav-icon">
          <LayoutDashboard size={20} />
        </span>
        <span className="admin-bottom-nav-label">نظرة عامة</span>
      </Link>

      <Link
        href="/admin/courses"
        className={`admin-bottom-nav-item ${isCourses && !sidebarOpen ? 'active' : ''}`}
        aria-current={isCourses && !sidebarOpen ? 'page' : undefined}
      >
        <span className="admin-bottom-nav-icon">
          <BookOpen size={20} />
        </span>
        <span className="admin-bottom-nav-label">الكورسات</span>
      </Link>

      <Link
        href="/admin/exams"
        className={`admin-bottom-nav-item ${isExams && !sidebarOpen ? 'active' : ''}`}
        aria-current={isExams && !sidebarOpen ? 'page' : undefined}
      >
        <span className="admin-bottom-nav-icon">
          <GraduationCap size={20} />
        </span>
        <span className="admin-bottom-nav-label">الامتحانات</span>
      </Link>

      <Link
        href="/admin/ai"
        className={`admin-bottom-nav-item ${isAI && !sidebarOpen ? 'active' : ''}`}
        aria-current={isAI && !sidebarOpen ? 'page' : undefined}
      >
        <span className="admin-bottom-nav-icon">
          <Sparkles size={20} />
        </span>
        <span className="admin-bottom-nav-label">المساعد</span>
      </Link>

      <button
        type="button"
        className={`admin-bottom-nav-item admin-bottom-nav-more ${isMoreActive ? 'active' : ''}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="فتح القائمة الكاملة"
        aria-expanded={sidebarOpen}
      >
        <span className="admin-bottom-nav-icon">
          <Menu size={20} />
          {totalPending > 0 && <span className="admin-bottom-nav-dot" aria-hidden="true" />}
        </span>
        <span className="admin-bottom-nav-label">المزيد</span>
      </button>
    </nav>
  );
}
