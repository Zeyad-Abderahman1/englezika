import { getPlatformEnv } from './platform';
import { validateEmailConfiguration } from './email-config';

export type EnvValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validatePlatformEnv(): EnvValidationResult {
  const env = getPlatformEnv();
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) {
    errors.push("Required PostgreSQL connection string 'DATABASE_URL' is missing");
  } else {
    try {
      const parsed = new URL(dbUrl);
      const host = parsed.hostname.toLowerCase();
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
      const sslParam =
        parsed.searchParams.get('sslmode')?.toLowerCase() ||
        parsed.searchParams.get('ssl')?.toLowerCase();
      const hasSsl =
        sslParam === 'require' ||
        sslParam === 'verify-full' ||
        sslParam === 'verify-ca' ||
        sslParam === 'true' ||
        sslParam === '1';
      if (!isLocal && !hasSsl) {
        console.warn(
          `[SECURITY WARNING] DATABASE_URL connects to remote host '${host}' without explicit SSL (e.g. ?sslmode=require). Encrypted transport is strongly recommended for remote databases.`
        );
      }
    } catch {
      // Non-standard database URL format; pg driver will validate during connection
    }
  }

  if (!env.PRIVATE_STORAGE_DIR?.trim()) {
    errors.push("Required private file directory 'PRIVATE_STORAGE_DIR' is missing");
  }

  // Validate session secret (SEC-03 & INFRA-04)
  const secret = (
    env.VERIFICATION_SECRET ?? (env as Record<string, string | undefined>).SESSION_SECRET
  )?.trim();
  if (!secret || secret.length < 24) {
    errors.push(
      "Required secret 'VERIFICATION_SECRET' (or 'SESSION_SECRET') is missing or too short (< 24 characters)"
    );
  }

  if (isProduction) {
    const trustedProxyHeader = env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
    if (trustedProxyHeader !== 'cf-connecting-ip' && trustedProxyHeader !== 'x-real-ip') {
      errors.push(
        "Production requires TRUSTED_PROXY_IP_HEADER to be 'cf-connecting-ip' or 'x-real-ip'"
      );
    }
    const appUrl = env.APP_URL?.trim();
    if (!appUrl) {
      errors.push("Required public application URL 'APP_URL' is missing");
    } else {
      try {
        const parsed = new URL(appUrl);
        if (parsed.protocol !== 'https:') errors.push('Production APP_URL must use HTTPS');
      } catch {
        errors.push('Production APP_URL must be a valid URL');
      }
    }
  }

  // Note: INITIAL_STAFF_* are bootstrap-only variables handled by scripts/bootstrap-initial-staff.mjs
  // and are not required during normal application runtime.

  errors.push(...validateEmailConfiguration(env, process.env.NODE_ENV));

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertPlatformEnv(): void {
  const result = validatePlatformEnv();
  if (!result.valid) {
    throw new Error(
      `[FATAL STARTUP ERROR] Environment Validation Failed:\n- ${result.errors.join('\n- ')}`
    );
  }
}
