export type PlatformEnv = {
  DB?: D1Database;
  VIDEOS?: R2Bucket;
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

export function getPlatformEnv(): PlatformEnv {
  return (globalThis as typeof globalThis & { __ENGLIZEKA_ENV__?: PlatformEnv }).__ENGLIZEKA_ENV__ ?? {};
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
