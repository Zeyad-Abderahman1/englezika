import type { PlatformEnv } from './platform';

export type EmailProvider = 'gmail' | 'serversmtp' | 'resend' | 'gmass';

export const SUPPORTED_EMAIL_PROVIDERS: readonly EmailProvider[] = [
  'gmail',
  'serversmtp',
  'resend',
  'gmass',
];

function providerCredentials(env: PlatformEnv) {
  return {
    gmailUser: env.GMAIL_USER?.trim(),
    gmailPassword: env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ''),
    smtpKey: env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim(),
    smtpSecret:
      env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim(),
    resendKey: env.RESEND_API_KEY?.trim(),
    gmassApiKey: env.GMASS_API_KEY?.trim(),
    emailFrom: env.EMAIL_FROM?.trim(),
  };
}

export function selectedEmailProvider(env: PlatformEnv): EmailProvider | null {
  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit && (SUPPORTED_EMAIL_PROVIDERS as readonly string[]).includes(explicit)) {
    return explicit as EmailProvider;
  }

  const credentials = providerCredentials(env);
  if (credentials.gmailUser && credentials.gmailPassword) return 'gmail';
  if (credentials.smtpKey && credentials.smtpSecret) return 'serversmtp';
  if (credentials.resendKey && credentials.emailFrom) return 'resend';
  if (credentials.gmassApiKey && credentials.emailFrom) return 'gmass';
  return null;
}

export function isEmailProviderConfigured(
  env: PlatformEnv,
  provider = selectedEmailProvider(env)
): boolean {
  if (!provider) return false;
  const credentials = providerCredentials(env);
  switch (provider) {
    case 'gmail':
      return Boolean(credentials.gmailUser && credentials.gmailPassword);
    case 'serversmtp':
      return Boolean(credentials.smtpKey && credentials.smtpSecret && credentials.emailFrom);
    case 'resend':
      return Boolean(credentials.resendKey && credentials.emailFrom);
    case 'gmass':
      return Boolean(credentials.gmassApiKey && credentials.emailFrom);
  }
}

export function emailTestModeEnabled(env: PlatformEnv, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production' && env.EMAIL_TEST_MODE?.trim().toLowerCase() === 'true';
}

export function validateEmailConfiguration(env: PlatformEnv, nodeEnv?: string): string[] {
  const errors: string[] = [];
  const testModeValue = env.EMAIL_TEST_MODE?.trim().toLowerCase();
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase();

  if (testModeValue && testModeValue !== 'true' && testModeValue !== 'false') {
    errors.push('EMAIL_TEST_MODE must be explicitly set to either true or false');
  }
  if (nodeEnv === 'production' && emailTestModeEnabled(env, 'development')) {
    errors.push('EMAIL_TEST_MODE cannot be enabled when NODE_ENV=production');
  }

  if (provider && !(SUPPORTED_EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
    errors.push('EMAIL_PROVIDER must be one of gmail, serversmtp, resend, or gmass');
  }

  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPassword = env.GMAIL_APP_PASSWORD?.trim();
  const smtpKey = env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim();
  const smtpSecret =
    env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();
  const emailFrom = env.EMAIL_FROM?.trim();
  const gmassApiKey = env.GMASS_API_KEY?.trim();

  if (provider === 'gmass') {
    if (!gmassApiKey) errors.push('GMASS_API_KEY is required when EMAIL_PROVIDER=gmass');
    if (!emailFrom) errors.push('EMAIL_FROM is required when EMAIL_PROVIDER=gmass');
  }
  if (provider === 'gmail' && (!gmailUser || !gmailPassword)) {
    errors.push('GMAIL_USER and GMAIL_APP_PASSWORD are required when EMAIL_PROVIDER=gmail');
  }
  if (provider === 'serversmtp') {
    if (!smtpKey || !smtpSecret) {
      errors.push(
        'ServerSMTP consumer key and secret are required when EMAIL_PROVIDER=serversmtp'
      );
    }
    if (!emailFrom) errors.push('EMAIL_FROM is required when EMAIL_PROVIDER=serversmtp');
  }
  if (provider === 'resend') {
    if (!resendKey) errors.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    if (!emailFrom) errors.push('EMAIL_FROM is required when EMAIL_PROVIDER=resend');
  }

  if (!provider && Boolean(gmailUser) !== Boolean(gmailPassword)) {
    errors.push('GMAIL_USER and GMAIL_APP_PASSWORD must be configured together');
  }
  if (!provider && Boolean(smtpKey) !== Boolean(smtpSecret)) {
    errors.push('ServerSMTP consumer key and secret must be configured together');
  }
  if (!provider && (smtpKey || resendKey) && !emailFrom) {
    errors.push('EMAIL_FROM is required for ServerSMTP or Resend delivery');
  }

  const hasProvider = isEmailProviderConfigured(env, provider as EmailProvider | null);

  if (nodeEnv === 'production' && !hasProvider) {
    errors.push(
      'Production requires a complete Gmail, ServerSMTP, Resend, or GMass email provider'
    );
  }

  return errors;
}
