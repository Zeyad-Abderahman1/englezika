import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResultsManagerView } from '../../components/admin/domains/ResultsManagerView';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';
import { AdminLoadingSkeleton } from '../../components/admin/shell/AdminLoadingSkeleton';

export const metadata: Metadata = {
  title: 'النتائج والتصحيح | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminResultsPage() {
  return (
    <PermissionGate permission="grade_exams">
      <Suspense fallback={<AdminLoadingSkeleton type="table" rows={6} />}>
        <ResultsManagerView />
      </Suspense>
    </PermissionGate>
  );
}
