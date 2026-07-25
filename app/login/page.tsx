import type { Metadata } from "next";
import AuthForm from "../components/AuthForm";

export const metadata: Metadata = {
  title: "تسجيل الدخول | إنجليزيكا",
  description: "سجّل الدخول لحسابك في منصة مستر أحمد حسن للغة الإنجليزية",
};
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-wrap auth-wrap-login">
        <div className="auth-heading">
          <span className="section-label">أهلًا بك</span>
          <h1>سجّل دخولك</h1>
          <p>عُد لكورساتك وامتحاناتك ونتائجك.</p>
        </div>
        <AuthForm mode="login" />
      </div>
    </main>
  );
}
