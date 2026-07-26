import type { Metadata } from 'next';
import AuthForm from '../components/AuthForm';

export const metadata: Metadata = {
  title: 'إنشاء حساب | إنجليزيكا',
  description: 'أنشئ حسابك في منصة مستر أحمد حسن للغة الإنجليزية وابدأ رحلتك التعليمية',
};
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <div className="auth-wrap auth-wrap-register">
        <AuthForm mode="register" />
      </div>
    </main>
  );
}
