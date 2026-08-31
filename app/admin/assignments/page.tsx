import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AssignmentsManagerView } from '../../components/admin/domains/AssignmentsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الواجبات والتكليفات | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminAssignmentsPage() {
  return (
    <PermissionGate permission="manage_assignments">
      <Suspense fallback={<AdminLoadingSkeleton type="cards" rows={4} />}>
        <AssignmentsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
