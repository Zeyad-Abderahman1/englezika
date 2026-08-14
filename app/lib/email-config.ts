import type { PlatformEnv } from './platform';

export function emailTestModeEnabled(env: PlatformEnv, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production' && env.EMAIL_TEST_MODE?.trim().toLowerCase() === 'true';
}

export function validateEmailConfiguration(env: PlatformEnv, nodeEnv?: string): string[] {
  const errors: string[] = [];
  const testModeValue = env.EMAIL_TEST_MODE?.trim().toLowerCase();

  if (testModeValue && testModeValue !== 'true' && testModeValue !== 'false') {
    errors.push('EMAIL_TEST_MODE must be explicitly set to either true or false');
  }
  if (nodeEnv === 'production' && emailTestModeEnabled(env, 'development')) {
    errors.push('EMAIL_TEST_MODE cannot be enabled when NODE_ENV=production');
  }

  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPassword = env.GMAIL_APP_PASSWORD?.trim();
  const smtpKey = env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim();
  const smtpSecret =
    env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();
  const emailFrom = env.EMAIL_FROM?.trim();

  if (Boolean(gmailUser) !== Boolean(gmailPassword)) {
    errors.push('GMAIL_USER and GMAIL_APP_PASSWORD must be configured together');
  }
  if (Boolean(smtpKey) !== Boolean(smtpSecret)) {
    errors.push('ServerSMTP consumer key and secret must be configured together');
  }
  if ((smtpKey || resendKey) && !emailFrom) {
    errors.push('EMAIL_FROM is required for ServerSMTP or Resend delivery');
  }

  const hasProvider =
    Boolean(gmailUser && gmailPassword) ||
    Boolean(smtpKey && smtpSecret && emailFrom) ||
    Boolean(resendKey && emailFrom);

  if (nodeEnv === 'production' && !hasProvider) {
    errors.push('Production requires a complete Gmail, ServerSMTP, or Resend email provider');
  }

  return errors;
}
