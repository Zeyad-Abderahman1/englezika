import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MessagesManagerView } from '../../components/admin/domains/MessagesManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'رسائل واستفسارات التواصل | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminMessagesPage() {
  return (
    <PermissionGate permission="manage_messages">
      <Suspense fallback={<AdminLoadingSkeleton type="cards" rows={4} />}>
        <MessagesManagerView />
      </Suspense>
    </PermissionGate>
  );
}
