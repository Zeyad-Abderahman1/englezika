import {
  Database,
  getDatabase as getPostgresDatabase,
  type Database as DatabaseType,
} from './database';
import {
  PrivateStorage,
  getPrivateStorage as getDiskStorage,
  type PrivateStoredObject,
} from './private-storage';

export type PlatformEnv = {
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
  VIDEO_RESOLVE_SECRET?: string;
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
  SESSION_SECRET?: string;
  TRUSTED_PROXY_IP_HEADER?: string;
};

type TestPlatform = PlatformEnv & {
  DB?: DatabaseType;
  STORAGE?: PrivateStorage;
};

function injectedTestPlatform(): TestPlatform | undefined {
  return (globalThis as typeof globalThis & { __ENGLIZEKA_ENV__?: TestPlatform })
    .__ENGLIZEKA_ENV__;
}

export function getPlatformEnv(): PlatformEnv {
  const injected = injectedTestPlatform();
  return {
    VERIFICATION_SECRET: injected?.VERIFICATION_SECRET ?? process.env.VERIFICATION_SECRET,
    VIDEO_RESOLVE_SECRET: injected?.VIDEO_RESOLVE_SECRET ?? process.env.VIDEO_RESOLVE_SECRET,
    GMAIL_USER: injected?.GMAIL_USER ?? process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: injected?.GMAIL_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD,
    SERVERSMTP_CONSUMER_KEY:
      injected?.SERVERSMTP_CONSUMER_KEY ?? process.env.SERVERSMTP_CONSUMER_KEY,
    SERVERSMTP_CONSUMER_SECRET:
      injected?.SERVERSMTP_CONSUMER_SECRET ?? process.env.SERVERSMTP_CONSUMER_SECRET,
    TURBO_SMTP_CONSUMER_KEY:
      injected?.TURBO_SMTP_CONSUMER_KEY ?? process.env.TURBO_SMTP_CONSUMER_KEY,
    TURBO_SMTP_CONSUMER_SECRET:
      injected?.TURBO_SMTP_CONSUMER_SECRET ?? process.env.TURBO_SMTP_CONSUMER_SECRET,
    RESEND_API_KEY: injected?.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
    EMAIL_FROM: injected?.EMAIL_FROM ?? process.env.EMAIL_FROM,
    EMAIL_TEST_MODE: injected?.EMAIL_TEST_MODE ?? process.env.EMAIL_TEST_MODE,
    INITIAL_STAFF_EMAIL: injected?.INITIAL_STAFF_EMAIL ?? process.env.INITIAL_STAFF_EMAIL,
    INITIAL_STAFF_NAME: injected?.INITIAL_STAFF_NAME ?? process.env.INITIAL_STAFF_NAME,
    INITIAL_STAFF_PASSWORD_HASH:
      injected?.INITIAL_STAFF_PASSWORD_HASH ?? process.env.INITIAL_STAFF_PASSWORD_HASH,
    INITIAL_STAFF_PASSWORD_SALT:
      injected?.INITIAL_STAFF_PASSWORD_SALT ?? process.env.INITIAL_STAFF_PASSWORD_SALT,
    INITIAL_STAFF_PASSWORD_ITERATIONS:
      injected?.INITIAL_STAFF_PASSWORD_ITERATIONS ??
      process.env.INITIAL_STAFF_PASSWORD_ITERATIONS,
    FAWATERAK_BASE_URL:
      injected?.FAWATERAK_BASE_URL ?? process.env.FAWATERAK_BASE_URL ?? 'https://app.fawaterk.com',
    FAWATERAK_CLIENT_ID: injected?.FAWATERAK_CLIENT_ID ?? process.env.FAWATERAK_CLIENT_ID,
    FAWATERAK_CLIENT_SECRET:
      injected?.FAWATERAK_CLIENT_SECRET ?? process.env.FAWATERAK_CLIENT_SECRET,
    FAWATERAK_VENDOR_API_KEY:
      injected?.FAWATERAK_VENDOR_API_KEY ?? process.env.FAWATERAK_VENDOR_API_KEY,
    APP_URL: injected?.APP_URL ?? process.env.APP_URL,
    SESSION_SECRET: injected?.SESSION_SECRET ?? process.env.SESSION_SECRET,
    TRUSTED_PROXY_IP_HEADER:
      injected?.TRUSTED_PROXY_IP_HEADER ?? process.env.TRUSTED_PROXY_IP_HEADER,
  };
}

export function getDatabase() {
  return injectedTestPlatform()?.DB ?? getPostgresDatabase();
}

export function getPrivateStorage() {
  return injectedTestPlatform()?.STORAGE ?? getDiskStorage();
}

export { Database, PrivateStorage, type PrivateStoredObject };
