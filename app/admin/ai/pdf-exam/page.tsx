import type { Metadata } from 'next';
import { PdfAssessmentWorkspace } from '../../../components/admin/ai/PdfAssessmentWorkspace';
import { PermissionGate } from '../../../components/admin/shell/PermissionGate';

export const metadata: Metadata = { title: 'مولد الاختبارات من PDF | لوحة الإدارة' };
export const dynamic = 'force-dynamic';

export default function AdminAiPdfExamPage() {
  return <PermissionGate permission="manage_courses"><PdfAssessmentWorkspace /></PermissionGate>;
}
