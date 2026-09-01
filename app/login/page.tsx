'use client';

import AuthForm from '../components/AuthForm';
import { useTranslation } from '../lib/i18n/use-translation';

export default function LoginPage() {
  const { t } = useTranslation();

  return (
    <main className="auth-page">
      <div className="auth-wrap auth-wrap-login">
        <div className="auth-heading">
          <span className="section-label">{t('auth.login_title')}</span>
          <h1>{t('auth.login_title')}</h1>
          <p>{t('auth.login_subtitle')}</p>
        </div>
        <AuthForm mode="login" />
      </div>
    </main>
  );
}
