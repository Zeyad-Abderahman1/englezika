'use client';

/**
 * app/components/admin/shell/AdminEmptyState.tsx
 *
 * Professional empty state card with icon, title, message, and action button.
 */

import { type ElementType, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface AdminEmptyStateProps {
  icon?: ElementType;
  title: string;
  description: string;
  action?: ReactNode;
}

export function AdminEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: AdminEmptyStateProps) {
  return (
    <div className="admin-empty-state" role="status">
      <div className="admin-empty-icon" aria-hidden="true">
        <Icon size={36} />
      </div>
      <h3 className="admin-empty-title">{title}</h3>
      <p className="admin-empty-description">{description}</p>
      {action && <div className="admin-empty-action">{action}</div>}
    </div>
  );
}
