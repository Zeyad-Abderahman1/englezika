import type { Metadata } from 'next';
import StudentDashboard from '../components/StudentDashboard';
import { requireStudentUser } from '../lib/student-session';

export const metadata: Metadata = { title: 'مساحتي التعليمية' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  await requireStudentUser('/account');
  return (
    <main className="portal-page">
      <div className="container">
        <StudentDashboard />
      </div>
    </main>
  );
}
