import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentsManagerView } from '../../components/admin/domains/StudentsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الطلاب | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminStudentsPage() {
  return (
    <PermissionGate permission="view_students">
      <Suspense fallback={<AdminLoadingSkeleton type="table" rows={8} />}>
        <StudentsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
