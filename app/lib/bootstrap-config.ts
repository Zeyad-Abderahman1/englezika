import type { PlatformEnv } from './platform';

export type BootstrapStaffConfig = {
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
};

const HEX_256 = /^[a-f0-9]{64}$/i;
const HEX_128 = /^[a-f0-9]{32}$/i;

export function getBootstrapStaffConfig(env: PlatformEnv): BootstrapStaffConfig {
  const email = env.INITIAL_STAFF_EMAIL?.trim().toLowerCase();
  const name = env.INITIAL_STAFF_NAME?.trim();
  const passwordHash = env.INITIAL_STAFF_PASSWORD_HASH?.trim();
  const passwordSalt = env.INITIAL_STAFF_PASSWORD_SALT?.trim();
  const iterationsText = env.INITIAL_STAFF_PASSWORD_ITERATIONS?.trim();

  const missing = [
    ['INITIAL_STAFF_EMAIL', email],
    ['INITIAL_STAFF_NAME', name],
    ['INITIAL_STAFF_PASSWORD_HASH', passwordHash],
    ['INITIAL_STAFF_PASSWORD_SALT', passwordSalt],
    ['INITIAL_STAFF_PASSWORD_ITERATIONS', iterationsText],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Initial staff bootstrap configuration is missing: ${missing.join(', ')}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email!)) {
    throw new Error('INITIAL_STAFF_EMAIL must be a valid email address');
  }
  if (!HEX_256.test(passwordHash!)) {
    throw new Error('INITIAL_STAFF_PASSWORD_HASH must be a 64-character hexadecimal SHA-256 hash');
  }
  if (!HEX_128.test(passwordSalt!)) {
    throw new Error('INITIAL_STAFF_PASSWORD_SALT must be a 32-character hexadecimal salt');
  }

  const passwordIterations = Number(iterationsText);
  if (!Number.isSafeInteger(passwordIterations) || passwordIterations !== 100_000) {
    throw new Error('INITIAL_STAFF_PASSWORD_ITERATIONS must explicitly be 100000');
  }

  return {
    email: email!,
    name: name!,
    passwordHash: passwordHash!,
    passwordSalt: passwordSalt!,
    passwordIterations,
  };
}
