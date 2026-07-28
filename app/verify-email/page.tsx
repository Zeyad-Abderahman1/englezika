import type { Metadata } from 'next';
import Link from 'next/link';
import EmailVerification from '../components/EmailVerification';

export const metadata: Metadata = { title: 'تأكيد البريد الإلكتروني' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email = '' } = await searchParams;
  const normalizedEmail = email.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  return (
    <main className="portal-page">
      <div className="container">
        {validEmail ? (
          <EmailVerification email={normalizedEmail} />
        ) : (
          <section className="verification-card">
            <h1>البريد الإلكتروني غير صحيح</h1>
            <p>ارجع إلى صفحة تسجيل الدخول وأدخل بريد حسابك مرة أخرى.</p>
            <Link className="btn btn-primary" href="/login">
              العودة إلى تسجيل الدخول
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
