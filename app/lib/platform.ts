export type PlatformEnv = {
  DB?: D1Database;
  VIDEOS?: R2Bucket;
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
    VERIFICATION_SECRET: currentEnv.VERIFICATION_SECRET || process.env.VERIFICATION_SECRET || "englizeka-local-development-secret-key-32-chars-long",
    SERVERSMTP_CONSUMER_KEY: currentEnv.SERVERSMTP_CONSUMER_KEY || process.env.SERVERSMTP_CONSUMER_KEY || "157bf2b629c168d3977d",
    SERVERSMTP_CONSUMER_SECRET: currentEnv.SERVERSMTP_CONSUMER_SECRET || process.env.SERVERSMTP_CONSUMER_SECRET || "gps48xYSdzBAL30coRvF",
    EMAIL_FROM: currentEnv.EMAIL_FROM || process.env.EMAIL_FROM || "verify@englizeka.com",
    EMAIL_TEST_MODE: currentEnv.EMAIL_TEST_MODE || process.env.EMAIL_TEST_MODE || "false",
  };
}

export function getD1(): D1Database {
  const db = getPlatformEnv().DB;
  if (!db) throw new Error("Database binding is unavailable");
  return db;
}

export function getVideoBucket(): R2Bucket {
  const bucket = getPlatformEnv().VIDEOS;
  if (!bucket) throw new Error("Video storage binding is unavailable");
  return bucket;
}
