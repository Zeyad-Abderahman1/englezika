import type { Metadata } from 'next';
import { EgyptianExamGeneratorWorkspace } from '../../../components/admin/ai/EgyptianExamGeneratorWorkspace';
import { PermissionGate } from '../../../components/admin/shell/PermissionGate';

export const metadata: Metadata = { title: 'مولد ام المدا المص | لو' };
export const dynamic = 'force-dynamic';

export default function AdminSchoolExamPage() {
  return (
    <PermissionGate permission="manage_exams">
      <EgyptianExamGeneratorWorkspace />
    </PermissionGate>
  );
}
