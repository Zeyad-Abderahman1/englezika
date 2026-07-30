import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getBootstrapStaffConfig } from '../app/lib/bootstrap-config.ts';

const validConfig = {
  INITIAL_STAFF_EMAIL: 'Bootstrap@Example.test',
  INITIAL_STAFF_NAME: 'Bootstrap Staff',
  INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
  INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
  INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
};

test('bootstrap staff credentials are explicit and strictly validated', () => {
  assert.throws(() => getBootstrapStaffConfig({}), /configuration is missing/);
  assert.throws(
    () => getBootstrapStaffConfig({ ...validConfig, INITIAL_STAFF_PASSWORD_HASH: 'weak' }),
    /64-character hexadecimal/
  );
  assert.throws(
    () => getBootstrapStaffConfig({ ...validConfig, INITIAL_STAFF_PASSWORD_ITERATIONS: '' }),
    /configuration is missing/
  );

  assert.deepEqual(getBootstrapStaffConfig(validConfig), {
    email: 'bootstrap@example.test',
    name: 'Bootstrap Staff',
    passwordHash: 'a'.repeat(64),
    passwordSalt: 'b'.repeat(32),
    passwordIterations: 100000,
  });
});

test('schema changes are migration-only and do not run from application requests', async () => {
  const migration = await readFile(
    new URL('../database/migrations/001_initial.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS native_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS audit_logs/);

});
