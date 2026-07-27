import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import StaffLoginForm from '../../components/StaffLoginForm';
import { getCurrentStaff } from '../../lib/staff-auth';

export const metadata: Metadata = {
  title: 'دخول المدرس',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function StaffLoginPage() {
  if (await getCurrentStaff()) redirect('/admin');
  return <StaffLoginForm />;
}
