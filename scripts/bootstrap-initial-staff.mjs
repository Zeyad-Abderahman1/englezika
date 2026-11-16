import { fileURLToPath } from 'node:url';
import process from 'node:process';
import crypto from 'node:crypto';
import pg from 'pg';

const HEX_256 = /^[a-f0-9]{64}$/i;
const HEX_128 = /^[a-f0-9]{32}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_ITERATIONS = 100_000;
const BOOTSTRAP_ADVISORY_LOCK_ID = 20260731;

const ALL_STAFF_PERMISSIONS = [
  'manage_courses',
  'manage_exams',
  'manage_assignments',
  'manage_videos',
  'manage_enrollments',
  'grade_exams',
  'manage_announcements',
  'manage_messages',
  'view_students',
  'manage_staff',
];

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPasswordPbkdf2(
  password,
  saltHex,
  iterations = PASSWORD_ITERATIONS
) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{1,2}/g) ?? [], (pair) => Number.parseInt(pair, 16))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt), iterations };
}

export function validateBootstrapEnv(env = process.env) {
  const email = env.INITIAL_STAFF_EMAIL?.trim().toLowerCase();
  const name = env.INITIAL_STAFF_NAME?.trim();
  const plaintextPassword = env.INITIAL_STAFF_PASSWORD?.trim();
  const passwordHash = env.INITIAL_STAFF_PASSWORD_HASH?.trim();
  const passwordSalt = env.INITIAL_STAFF_PASSWORD_SALT?.trim();
  const iterationsText = env.INITIAL_STAFF_PASSWORD_ITERATIONS?.trim();

  if (!email || !name) {
    throw new Error('INITIAL_STAFF_EMAIL and INITIAL_STAFF_NAME are required for bootstrap');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error('INITIAL_STAFF_EMAIL must be a valid email address');
  }

  if (plaintextPassword) {
    if (plaintextPassword.length < 12) {
      throw new Error('INITIAL_STAFF_PASSWORD must be at least 12 characters long');
    }
    return {
      email,
      name,
      plaintextPassword,
      usePlaintext: true,
    };
  }

  const missing = [
    ['INITIAL_STAFF_PASSWORD_HASH', passwordHash],
    ['INITIAL_STAFF_PASSWORD_SALT', passwordSalt],
    ['INITIAL_STAFF_PASSWORD_ITERATIONS', iterationsText],
  ]
    .filter(([, val]) => !val)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Initial staff bootstrap configuration is missing: ${missing.join(', ')} (or provide INITIAL_STAFF_PASSWORD)`
    );
  }

  if (!HEX_256.test(passwordHash)) {
    throw new Error('INITIAL_STAFF_PASSWORD_HASH must be a 64-character hexadecimal SHA-256 hash');
  }
  if (!HEX_128.test(passwordSalt)) {
    throw new Error('INITIAL_STAFF_PASSWORD_SALT must be a 32-character hexadecimal salt');
  }
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations !== 100_000) {
    throw new Error('INITIAL_STAFF_PASSWORD_ITERATIONS must explicitly be 100000');
  }

  return {
    email,
    name,
    passwordHash,
    passwordSalt,
    passwordIterations: iterations,
    usePlaintext: false,
  };
}

export async function bootstrapInitialStaff(options = {}) {
  const env = options.env || process.env;
  const databaseUrl = options.databaseUrl || env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to perform staff bootstrap');
  }

  const config = validateBootstrapEnv(env);

  let hash = config.passwordHash;
  let salt = config.passwordSalt;
  let iterations = config.passwordIterations || PASSWORD_ITERATIONS;

  if (config.usePlaintext) {
    const hashed = await hashPasswordPbkdf2(config.plaintextPassword);
    hash = hashed.hash;
    salt = hashed.salt;
    iterations = hashed.iterations;
  }

  const client = options.pgClient || options.client || new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // 1. Verify schema migration / table exists
    const tableCheck = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_users'"
    );
    if (tableCheck.rowCount === 0) {
      throw new Error(
        "Database table 'staff_users' does not exist. Run database migrations first (npm run db:migrate)."
      );
    }

    // 2. Acquire advisory lock to prevent race conditions during concurrent bootstrap attempts
    await client.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_ADVISORY_LOCK_ID]);

    try {
      // 3. Check if any staff account already exists
      const existingCountResult = await client.query('SELECT COUNT(*) AS count FROM staff_users');
      const staffCount = Number(existingCountResult.rows[0]?.count || 0);

      if (staffCount > 0) {
        return {
          created: false,
          alreadyExisted: true,
          message: `Staff account(s) already exist (${staffCount} account(s) found). Bootstrap skipped.`,
        };
      }

      // 4. In a transaction, create the initial staff account
      await client.query('BEGIN');
      try {
        const now = Date.now();
        const permissionsJson = JSON.stringify(ALL_STAFF_PERMISSIONS);

        await client.query(
          `INSERT INTO staff_users
           (email, name, role, permissions, password_hash, password_salt, password_iterations,
            active, failed_attempts, locked_until, created_by, created_at, updated_at)
           VALUES ($1, $2, 'teacher', $3, $4, $5, $6, 1, 0, NULL, 'bootstrap', $7, $8)`,
          [config.email, config.name, permissionsJson, hash, salt, iterations, now, now]
        );

        await client.query('COMMIT');

        return {
          created: true,
          alreadyExisted: false,
          email: config.email,
          name: config.name,
          message: `Initial staff administrator account successfully created for ${config.email}.`,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [BOOTSTRAP_ADVISORY_LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bootstrapInitialStaff()
    .then((result) => {
      process.stdout.write(`[bootstrap] ${result.message}\n`);
      process.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`[bootstrap error] ${error.message}\n`);
      process.exit(1);
    });
}
