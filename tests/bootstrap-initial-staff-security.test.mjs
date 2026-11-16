import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  bootstrapInitialStaff,
  hashPasswordPbkdf2,
  validateBootstrapEnv,
} from '../scripts/bootstrap-initial-staff.mjs';
import { validatePlatformEnv } from '../app/lib/env.ts';
import { verifyStaffCredentials, hashPassword } from '../app/lib/staff-auth.ts';

class MockPgClient {
  static instances = [];
  static sharedAdvisoryLock = null;
  tableExists = true;
  staffUsers = [];
  queries = [];
  inTransaction = false;

  constructor(config) {
    this.config = config;
    MockPgClient.instances.push(this);
  }

  async connect() {}
  async end() {
    if (MockPgClient.sharedAdvisoryLock === this) {
      MockPgClient.sharedAdvisoryLock = null;
    }
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });

    if (sql.includes('information_schema.tables')) {
      return { rowCount: this.tableExists ? 1 : 0, rows: this.tableExists ? [{ '1': 1 }] : [] };
    }
    if (sql.includes('pg_advisory_lock')) {
      while (MockPgClient.sharedAdvisoryLock && MockPgClient.sharedAdvisoryLock !== this) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      MockPgClient.sharedAdvisoryLock = this;
      return { rowCount: 1, rows: [{ pg_advisory_lock: true }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      if (MockPgClient.sharedAdvisoryLock === this) {
        MockPgClient.sharedAdvisoryLock = null;
      }
      return { rowCount: 1, rows: [{ pg_advisory_unlock: true }] };
    }
    if (sql.includes('COUNT(*) AS count FROM staff_users')) {
      return { rowCount: 1, rows: [{ count: this.staffUsers.length }] };
    }
    if (sql.trim() === 'BEGIN') {
      this.inTransaction = true;
      return { rowCount: 0, rows: [] };
    }
    if (sql.trim() === 'COMMIT') {
      this.inTransaction = false;
      return { rowCount: 0, rows: [] };
    }
    if (sql.trim() === 'ROLLBACK') {
      this.inTransaction = false;
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO staff_users')) {
      const [email, name, permissions, hash, salt, iterations, createdAt, updatedAt] = params;
      const user = {
        email,
        name,
        role: 'teacher',
        permissions,
        password_hash: hash,
        password_salt: salt,
        password_iterations: iterations,
        active: 1,
        failed_attempts: 0,
        locked_until: null,
        created_by: 'bootstrap',
        created_at: createdAt,
        updated_at: updatedAt,
      };
      this.staffUsers.push(user);
      return { rowCount: 1, rows: [user] };
    }
    return { rowCount: 0, rows: [] };
  }
}

class MockStaffAuthDb {
  constructor(staffList) {
    this.staffList = staffList;
  }

  prepare(sql) {
    const staffList = this.staffList;
    return new (class {
      bindings = [];
      bind(...args) {
        this.bindings = args;
        return this;
      }
      async first() {
        if (sql.includes('FROM staff_users WHERE email = ?')) {
          const email = this.bindings[0];
          const found = staffList.find((s) => s.email === email);
          if (!found) return null;
          return {
            email: found.email,
            name: found.name,
            role: found.role,
            permissions: found.permissions,
            passwordHash: found.password_hash,
            passwordSalt: found.password_salt,
            passwordIterations: found.password_iterations,
            active: found.active,
            failedAttempts: found.failed_attempts,
            lockedUntil: found.locked_until,
          };
        }
        return null;
      }
      async run() {
        return { success: true, meta: { changes: 1 } };
      }
    })();
  }
}

const validEnv = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  INITIAL_STAFF_EMAIL: 'teacher@englezika.test',
  INITIAL_STAFF_NAME: 'Mr Ahmed Hassan',
  INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
  INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
  INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
};

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('1. Fresh DB / no staff: bootstrap succeeds and creates exactly one admin', async () => {
  const mockPg = new MockPgClient();
  const result = await bootstrapInitialStaff({
    env: validEnv,
    databaseUrl: validEnv.DATABASE_URL,
    pgClient: mockPg,
  });

  assert.equal(result.created, true);
  assert.equal(result.alreadyExisted, false);
  assert.equal(result.email, 'teacher@englezika.test');
  assert.equal(result.name, 'Mr Ahmed Hassan');
  assert.match(result.message, /successfully created/);
});

test('2. Existing staff: bootstrap creates nothing and reports clear message', async () => {
  const existingStaff = [
    { email: 'existing@englezika.test', name: 'Existing Admin', role: 'teacher' },
  ];

  const client = new MockPgClient();
  client.staffUsers = [...existingStaff];

  const result = await bootstrapInitialStaff({
    env: validEnv,
    databaseUrl: validEnv.DATABASE_URL,
    pgClient: client,
  });

  assert.equal(result.created, false);
  assert.equal(result.alreadyExisted, true);
  assert.equal(client.staffUsers.length, 1);
  assert.match(result.message, /already exist/);
});

test('3. Second bootstrap execution: no duplicate is created', async () => {
  const client = new MockPgClient();
  const firstRun = await bootstrapInitialStaff({
    env: validEnv,
    databaseUrl: validEnv.DATABASE_URL,
    pgClient: client,
  });
  assert.equal(firstRun.created, true);
  assert.equal(client.staffUsers.length, 1);

  const secondRun = await bootstrapInitialStaff({
    env: validEnv,
    databaseUrl: validEnv.DATABASE_URL,
    pgClient: client,
  });
  assert.equal(secondRun.created, false);
  assert.equal(secondRun.alreadyExisted, true);
  assert.equal(client.staffUsers.length, 1);
});

test('4. Concurrent/double bootstrap: cannot create multiple first admins', async () => {
  const sharedStaffUsers = [];
  const clientA = new MockPgClient();
  const clientB = new MockPgClient();
  clientA.staffUsers = sharedStaffUsers;
  clientB.staffUsers = sharedStaffUsers;

  const [resA, resB] = await Promise.all([
    bootstrapInitialStaff({
      env: validEnv,
      databaseUrl: validEnv.DATABASE_URL,
      pgClient: clientA,
    }),
    bootstrapInitialStaff({
      env: validEnv,
      databaseUrl: validEnv.DATABASE_URL,
      pgClient: clientB,
    }),
  ]);

  const createdCount = (resA.created ? 1 : 0) + (resB.created ? 1 : 0);
  assert.equal(createdCount, 1, 'Exactly one concurrent execution should create the admin');
  assert.equal(sharedStaffUsers.length, 1);
});

test('5. Malformed bootstrap configuration fails safely', () => {
  // Invalid email
  assert.throws(
    () => validateBootstrapEnv({ ...validEnv, INITIAL_STAFF_EMAIL: 'notanemail' }),
    /valid email address/
  );

  // Short hash
  assert.throws(
    () => validateBootstrapEnv({ ...validEnv, INITIAL_STAFF_PASSWORD_HASH: 'short' }),
    /64-character/
  );

  // Invalid salt
  assert.throws(
    () => validateBootstrapEnv({ ...validEnv, INITIAL_STAFF_PASSWORD_SALT: 'short' }),
    /32-character/
  );

  // Invalid iterations
  assert.throws(
    () => validateBootstrapEnv({ ...validEnv, INITIAL_STAFF_PASSWORD_ITERATIONS: '50000' }),
    /100000/
  );
});

test('6. Missing required bootstrap configuration fails safely', () => {
  assert.throws(() => validateBootstrapEnv({}), /required for bootstrap/);
  assert.throws(
    () =>
      validateBootstrapEnv({
        INITIAL_STAFF_EMAIL: 'test@example.test',
        INITIAL_STAFF_NAME: 'Test',
      }),
    /Initial staff bootstrap configuration is missing/
  );
});

test('7. Plaintext password bootstrap configuration validates and hashes safely', async () => {
  const plaintextEnv = {
    INITIAL_STAFF_EMAIL: 'teacher@englezika.test',
    INITIAL_STAFF_NAME: 'Mr Ahmed Hassan',
    INITIAL_STAFF_PASSWORD: 'StrongPassword123!#',
  };

  const parsed = validateBootstrapEnv(plaintextEnv);
  assert.equal(parsed.usePlaintext, true);
  assert.equal(parsed.plaintextPassword, 'StrongPassword123!#');

  const hashed = await hashPasswordPbkdf2(parsed.plaintextPassword);
  assert.equal(hashed.hash.length, 64);
  assert.equal(hashed.salt.length, 32);
  assert.equal(hashed.iterations, 100_000);
});

test('8. Normal application startup after bootstrap works WITHOUT INITIAL_STAFF_*', () => {
  const runtimeEnv = {
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/englizeka',
    PRIVATE_STORAGE_DIR: './storage/private',
    VERIFICATION_SECRET: 'a'.repeat(32),
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: 'gmass-key',
    EMAIL_FROM: 'Englizeka <info@englezika.com>',
  };

  globalThis.__ENGLIZEKA_ENV__ = runtimeEnv;
  const result = validatePlatformEnv();
  assert.equal(result.valid, true, `Expected valid env, but got errors: ${result.errors.join(', ')}`);
});

test('9. Generated account can authenticate through existing staff authentication mechanism', async () => {
  const rawPassword = 'SecureStaffPassword2026!';
  const credentials = await hashPassword(rawPassword);

  const staffUser = {
    email: 'teacher@englezika.test',
    name: 'Mr Ahmed Hassan',
    role: 'teacher',
    permissions: JSON.stringify([
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
    ]),
    password_hash: credentials.hash,
    password_salt: credentials.salt,
    password_iterations: credentials.iterations,
    active: 1,
    failed_attempts: 0,
    locked_until: null,
  };

  const db = new MockStaffAuthDb([staffUser]);
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const session = await verifyStaffCredentials('teacher@englezika.test', rawPassword);
  assert.ok(session, 'Authentication should succeed');
  assert.equal(session.email, 'teacher@englezika.test');
  assert.equal(session.role, 'teacher');
  assert.equal(session.permissions.includes('manage_courses'), true);
  assert.equal(session.permissions.includes('manage_staff'), true);

  // Wrong password fails
  const failedSession = await verifyStaffCredentials('teacher@englezika.test', 'WrongPassword123!');
  assert.equal(failedSession, null);
});
