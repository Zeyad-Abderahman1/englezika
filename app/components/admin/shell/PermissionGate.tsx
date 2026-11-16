'use client';

/**
 * app/components/admin/shell/PermissionGate.tsx
 *
 * Client-side route and component permission guard.
 * Shows a polished Arabic unauthorized fallback if an assistant visits
 * a section they do not possess permissions for.
 */

import { type ReactNode } from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import type { StaffPermission } from '../../../lib/staff-permissions';

interface PermissionGateProps {
  permission: StaffPermission;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({
  permission,
  children,
  fallback,
}: PermissionGateProps) {
  const { can, loading } = useAdmin();

  if (loading) {
    return (
      <div className="admin-loading-state">
        <div className="admin-spinner" />
        <p>جاري التحقق من الصلاحيات...</p>
      </div>
    );
  }

  if (can(permission)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="admin-unauthorized-page" role="alert">
      <div className="admin-unauthorized-card">
        <div className="admin-unauthorized-icon">
          <ShieldAlert size={48} />
        </div>
        <h2>عذرًا، لا تملك الصلاحية للوصول إلى هذه الصفحة</h2>
        <p>
          حسابك الحالي لا يمتلك صلاحية <code>{permission}</code>. إذا كنت تعتقد أن هذا خطأ،
          يرجى التواصل مع المدرس أو المسؤول لتحديث صلاحيات حسابك.
        </p>
        <div className="admin-unauthorized-actions">
          <Link href="/admin" className="btn btn-primary">
            <ArrowRight size={16} /> العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
