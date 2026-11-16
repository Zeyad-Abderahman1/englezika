import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AIAssistantWorkspace } from '../../../components/admin/ai/AIAssistantWorkspace';
import { AdminLoadingSkeleton } from '../../../components/admin/shell/AdminLoadingSkeleton';
import { PermissionGate } from '../../../components/admin/shell/PermissionGate';

export const metadata: Metadata = { title: 'المساعد الذكي | لوحة الإدارة' };
export const dynamic = 'force-dynamic';

export default function AdminAiAssistantPage() {
  return <PermissionGate permission="manage_courses"><Suspense fallback={<AdminLoadingSkeleton type="cards" rows={3} />}><AIAssistantWorkspace /></Suspense></PermissionGate>;
}
