import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AdminDashboard from '../components/AdminDashboard';
import { getCurrentStaff } from '../lib/staff-auth';

export const metadata: Metadata = { title: 'لوحة المدرس' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!(await getCurrentStaff())) redirect('/staff/login');
  return (
    <main className="admin-page">
      <AdminDashboard />
    </main>
  );
}
