export type PlatformEnv = {
  DB?: D1Database;
  VIDEOS?: R2Bucket;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  SERVERSMTP_CONSUMER_KEY?: string;
  SERVERSMTP_CONSUMER_SECRET?: string;
  TURBO_SMTP_CONSUMER_KEY?: string;
  TURBO_SMTP_CONSUMER_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_TEST_MODE?: string;
  VERIFICATION_SECRET?: string;
  INITIAL_STAFF_EMAIL?: string;
  INITIAL_STAFF_NAME?: string;
  INITIAL_STAFF_PASSWORD_HASH?: string;
  INITIAL_STAFF_PASSWORD_SALT?: string;
  INITIAL_STAFF_PASSWORD_ITERATIONS?: string;
  FAWATERAK_BASE_URL?: string;
  FAWATERAK_CLIENT_ID?: string;
  FAWATERAK_CLIENT_SECRET?: string;
  FAWATERAK_VENDOR_API_KEY?: string;
  APP_URL?: string;
};

let cachedPlatformEnv: PlatformEnv | null = null;

export function getPlatformEnv(): PlatformEnv {
  const globalObject = globalThis as typeof globalThis & { __ENGLIZEKA_ENV__?: PlatformEnv };
  if (globalObject.__ENGLIZEKA_ENV__?.DB) {
    cachedPlatformEnv = globalObject.__ENGLIZEKA_ENV__;
  }
  const currentEnv = globalObject.__ENGLIZEKA_ENV__ || cachedPlatformEnv || {};
  return {
    ...currentEnv,
    VERIFICATION_SECRET:
      currentEnv.VERIFICATION_SECRET ||
      process.env.VERIFICATION_SECRET ||
      'englizeka-local-development-secret-key-32-chars-long',
    GMAIL_USER: currentEnv.GMAIL_USER || process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: currentEnv.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD,
    SERVERSMTP_CONSUMER_KEY:
      currentEnv.SERVERSMTP_CONSUMER_KEY || process.env.SERVERSMTP_CONSUMER_KEY,
    SERVERSMTP_CONSUMER_SECRET:
      currentEnv.SERVERSMTP_CONSUMER_SECRET || process.env.SERVERSMTP_CONSUMER_SECRET,
    TURBO_SMTP_CONSUMER_KEY:
      currentEnv.TURBO_SMTP_CONSUMER_KEY || process.env.TURBO_SMTP_CONSUMER_KEY,
    TURBO_SMTP_CONSUMER_SECRET:
      currentEnv.TURBO_SMTP_CONSUMER_SECRET || process.env.TURBO_SMTP_CONSUMER_SECRET,
    RESEND_API_KEY: currentEnv.RESEND_API_KEY || process.env.RESEND_API_KEY,
    EMAIL_FROM: currentEnv.EMAIL_FROM || process.env.EMAIL_FROM || 'verify@englizeka.com',
    EMAIL_TEST_MODE: currentEnv.EMAIL_TEST_MODE || process.env.EMAIL_TEST_MODE || 'false',
    FAWATERAK_BASE_URL:
      currentEnv.FAWATERAK_BASE_URL || process.env.FAWATERAK_BASE_URL || 'https://app.fawaterk.com',
    FAWATERAK_CLIENT_ID: currentEnv.FAWATERAK_CLIENT_ID || process.env.FAWATERAK_CLIENT_ID,
    FAWATERAK_CLIENT_SECRET:
      currentEnv.FAWATERAK_CLIENT_SECRET || process.env.FAWATERAK_CLIENT_SECRET,
    FAWATERAK_VENDOR_API_KEY:
      currentEnv.FAWATERAK_VENDOR_API_KEY || process.env.FAWATERAK_VENDOR_API_KEY,
    APP_URL: currentEnv.APP_URL || process.env.APP_URL,
  };
}

export function getD1(): D1Database {
  const db = getPlatformEnv().DB;
  if (!db) throw new Error('Database binding is unavailable');
  return db;
}

export function getVideoBucket(): R2Bucket {
  const bucket = getPlatformEnv().VIDEOS;
  if (!bucket) throw new Error('Video storage binding is unavailable');
  return bucket;
}
