import { getPlatformEnv } from './platform';
import { getBootstrapStaffConfig } from './bootstrap-config';
import { validateEmailConfiguration } from './email-config';

export type EnvValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validatePlatformEnv(): EnvValidationResult {
  const env = getPlatformEnv();
  const errors: string[] = [];

  // Validate database binding
  if (!env.DB) {
    errors.push("Cloudflare D1 database binding 'DB' is missing");
  }

  // Validate R2 storage binding
  if (!env.VIDEOS) {
    errors.push("Cloudflare R2 storage binding 'VIDEOS' is missing");
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

  try {
    getBootstrapStaffConfig(env);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Initial staff bootstrap is invalid');
  }

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
