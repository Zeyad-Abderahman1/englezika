import type { PlatformEnv } from './platform';

export type EmailProvider = 'gmail' | 'serversmtp' | 'resend' | 'gmass' | 'billionmail';

export const SUPPORTED_EMAIL_PROVIDERS: readonly EmailProvider[] = [
  'gmail',
  'serversmtp',
  'resend',
  'gmass',
  'billionmail',
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
    billionmailHost: env.BILLIONMAIL_SMTP_HOST?.trim(),
    billionmailUser: env.BILLIONMAIL_SMTP_USER?.trim(),
    billionmailPassword: env.BILLIONMAIL_SMTP_PASSWORD?.trim(),
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
  if (credentials.billionmailHost && credentials.billionmailUser && credentials.billionmailPassword && credentials.emailFrom)
    return 'billionmail';
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
    case 'billionmail':
      return Boolean(
        credentials.billionmailHost &&
          credentials.billionmailUser &&
          credentials.billionmailPassword &&
          credentials.emailFrom
      );
  }
}

export function emailTestModeEnabled(env: PlatformEnv, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production' && env.EMAIL_TEST_MODE?.trim().toLowerCase() === 'true';
}

/**
 * Parse and validate the BillionMail SMTP port from environment config.
 * Returns the numeric port or throws a descriptive error.
 */
export function parseBillionmailPort(env: PlatformEnv): number {
  const raw = env.BILLIONMAIL_SMTP_PORT?.trim();
  if (!raw) return 587; // default STARTTLS port
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `BILLIONMAIL_SMTP_PORT must be an integer between 1 and 65535 (received: ${raw})`
    );
  }
  return port;
}

/**
 * Parse BILLIONMAIL_SMTP_SECURE into a boolean.
 * Only 'true' and 'false' (case-insensitive) are accepted; any other value is rejected.
 * When absent, defaults to false (STARTTLS on port 587).
 */
export function parseBillionmailSecure(env: PlatformEnv): boolean {
  const raw = env.BILLIONMAIL_SMTP_SECURE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(
    `BILLIONMAIL_SMTP_SECURE must be 'true' or 'false' (received: ${raw})`
  );
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
    errors.push(
      'EMAIL_PROVIDER must be one of gmail, serversmtp, resend, gmass, or billionmail'
    );
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
  if (provider === 'billionmail') {
    const bmHost = env.BILLIONMAIL_SMTP_HOST?.trim();
    const bmUser = env.BILLIONMAIL_SMTP_USER?.trim();
    const bmPassword = env.BILLIONMAIL_SMTP_PASSWORD?.trim();
    if (!bmHost) errors.push('BILLIONMAIL_SMTP_HOST is required when EMAIL_PROVIDER=billionmail');
    if (!bmUser) errors.push('BILLIONMAIL_SMTP_USER is required when EMAIL_PROVIDER=billionmail');
    if (!bmPassword)
      errors.push('BILLIONMAIL_SMTP_PASSWORD is required when EMAIL_PROVIDER=billionmail');
    if (!emailFrom) errors.push('EMAIL_FROM is required when EMAIL_PROVIDER=billionmail');
    // Validate port and secure parsing eagerly so startup fails immediately on bad config
    try {
      parseBillionmailPort(env);
    } catch (e) {
      errors.push((e as Error).message);
    }
    try {
      parseBillionmailSecure(env);
    } catch (e) {
      errors.push((e as Error).message);
    }
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
      'Production requires a complete Gmail, ServerSMTP, Resend, GMass, or BillionMail email provider'
    );
  }

  return errors;
}
