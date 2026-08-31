'use client';

/**
 * app/components/admin/shell/AdminBreadcrumbs.tsx
 *
 * Navigational breadcrumbs showing hierarchical location in the admin panel.
 */

import Link from 'next/link';
import { ChevronLeft, Home } from 'lucide-react';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

interface AdminBreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function AdminBreadcrumbs({ items }: AdminBreadcrumbsProps) {
  return (
    <nav className="admin-breadcrumbs" aria-label="مسار التنقل">
      <Link href="/admin" className="breadcrumb-home" aria-label="لوحة الإدارة">
        <Home size={14} />
        <span>الرئيسية</span>
      </Link>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={index} className="breadcrumb-segment">
            <ChevronLeft size={13} className="breadcrumb-separator" aria-hidden="true" />
            {item.href && !isLast ? (
              <Link href={item.href} className="breadcrumb-link">
                {item.label}
              </Link>
            ) : (
              <span className="breadcrumb-current" aria-current="page">
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
