import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminOverviewView } from '../components/admin/domains/AdminOverviewView';
import { AdminLoadingSkeleton } from '../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'نظرة عامة | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<AdminLoadingSkeleton type="metrics" />}>
      <AdminOverviewView />
    </Suspense>
  );
}
