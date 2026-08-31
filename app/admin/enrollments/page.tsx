import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EnrollmentsManagerView } from '../../components/admin/domains/EnrollmentsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الاشتراكات | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminEnrollmentsPage() {
  return (
    <PermissionGate permission="manage_enrollments">
      <Suspense fallback={<AdminLoadingSkeleton type="table" rows={6} />}>
        <EnrollmentsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
