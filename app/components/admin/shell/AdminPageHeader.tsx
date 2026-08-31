'use client';

/**
 * app/components/admin/shell/AdminPageHeader.tsx
 *
 * Consistent header across all admin domain pages, providing page title,
 * description, badge counter, and primary/secondary action buttons.
 */

import { type ReactNode } from 'react';
import { AdminBreadcrumbs, type BreadcrumbItem } from './AdminBreadcrumbs';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}

export function AdminPageHeader({
  title,
  description,
  badge,
  breadcrumbs,
  actions,
}: AdminPageHeaderProps) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-header-main">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <AdminBreadcrumbs items={breadcrumbs} />
        )}
        <div className="admin-page-title-row">
          <div className="admin-page-title-group">
            <h1 className="admin-page-title">{title}</h1>
            {badge && <div className="admin-page-badge">{badge}</div>}
          </div>
          {actions && <div className="admin-page-actions">{actions}</div>}
        </div>
        {description && <p className="admin-page-description">{description}</p>}
      </div>
    </header>
  );
}
