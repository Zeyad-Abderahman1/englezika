import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CoursesManagerView } from '../../components/admin/domains/CoursesManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الكورسات | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminCoursesPage() {
  return (
    <PermissionGate permission="manage_courses">
      <Suspense fallback={<AdminLoadingSkeleton type="cards" rows={4} />}>
        <CoursesManagerView />
      </Suspense>
    </PermissionGate>
  );
}
