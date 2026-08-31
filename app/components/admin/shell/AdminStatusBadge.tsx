'use client';

/**
 * app/components/admin/shell/AdminStatusBadge.tsx
 *
 * Visual status pill/badge for various entity states:
 * published / draft / pending / approved / rejected / active / suspended.
 */

interface AdminStatusBadgeProps {
  status: 'published' | 'draft' | 'pending' | 'approved' | 'rejected' | 'active' | 'suspended' | string;
  label?: string;
}

export function AdminStatusBadge({ status, label }: AdminStatusBadgeProps) {
  let badgeClass = 'status-pill';
  let defaultLabel = status;

  switch (status) {
    case 'published':
      badgeClass += ' status-approved';
      defaultLabel = 'منشور';
      break;
    case 'draft':
      badgeClass += ' status-pending';
      defaultLabel = 'مسودة';
      break;
    case 'approved':
      badgeClass += ' status-approved';
      defaultLabel = 'مفعّل';
      break;
    case 'pending':
      badgeClass += ' status-pending';
      defaultLabel = 'معلّق';
      break;
    case 'rejected':
      badgeClass += ' status-rejected';
      defaultLabel = 'مرفوض';
      break;
    case 'active':
      badgeClass += ' status-approved';
      defaultLabel = 'نشط';
      break;
    case 'suspended':
      badgeClass += ' status-rejected';
      defaultLabel = 'موقوف';
      break;
    case 'new':
      badgeClass += ' status-pending';
      defaultLabel = 'جديد';
      break;
    case 'reviewed':
      badgeClass += ' status-approved';
      defaultLabel = 'تمت المراجعة';
      break;
    default:
      badgeClass += ' status-pending';
      defaultLabel = status;
  }

  return <span className={badgeClass}>{label || defaultLabel}</span>;
}
