import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamsManagerView } from '../../components/admin/domains/ExamsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الامتحانات والاختبارات | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminExamsPage() {
  return (
    <PermissionGate permission="manage_exams">
      <Suspense fallback={<AdminLoadingSkeleton type="cards" rows={4} />}>
        <ExamsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
