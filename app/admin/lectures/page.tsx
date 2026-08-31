import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LecturesManagerView } from '../../components/admin/domains/LecturesManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'المحاضرات ومكتبة الفيديو | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminLecturesPage() {
  return (
    <PermissionGate permission="manage_videos">
      <Suspense fallback={<AdminLoadingSkeleton type="table" rows={6} />}>
        <LecturesManagerView />
      </Suspense>
    </PermissionGate>
  );
}
