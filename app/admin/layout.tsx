import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentStaff } from '../lib/staff-auth';
import { AdminProvider } from '../lib/admin-context';
import { AdminShell } from '../components/admin/shell/AdminShell';
import '../admin.css';

export const metadata: Metadata = {
  title: 'لوحة الإدارة | Englizeka',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect('/staff/login');
  }

  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}
