import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnnouncementsManagerView } from '../../components/admin/domains/AnnouncementsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'الإعلانات | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminAnnouncementsPage() {
  return (
    <PermissionGate permission="manage_announcements">
      <Suspense fallback={<AdminLoadingSkeleton type="cards" rows={3} />}>
        <AnnouncementsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
