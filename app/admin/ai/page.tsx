import type { Metadata } from 'next';
import { AIHub } from '../../components/admin/ai/AIHub';
import { PermissionGate } from '../../components/admin/shell/PermissionGate';

export const metadata: Metadata = {
  title: 'أدوات الذكاء الاصطناعي | لوحة الإدارة',
};

export const dynamic = 'force-dynamic';

export default function AdminAiPage() {
  return (
    <PermissionGate permission="manage_courses">
      <AIHub />
    </PermissionGate>
  );
}
