import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StaffManagerView } from '../../components/admin/domains/StaffManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'حسابات الفريق | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminStaffPage() {
  return (
    <PermissionGate permission="manage_staff">
      <Suspense fallback={<AdminLoadingSkeleton type="table" rows={4} />}>
        <StaffManagerView />
      </Suspense>
    </PermissionGate>
  );
}
