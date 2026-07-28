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

test('database bootstrap is insert-only and contains no credential fallback', async () => {
  const runtime = await readFile(new URL('../db/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /ON CONFLICT\(email\) DO NOTHING/);
  assert.doesNotMatch(runtime, /admin@englizeka\.com/);
  assert.doesNotMatch(runtime, /5edd6ddce8c584b61abae1f004bd5ca1e/);
  assert.doesNotMatch(runtime, /e3c8a797c8950b1e5287fceeb1271069/);
  assert.doesNotMatch(runtime, /ON CONFLICT\(email\) DO UPDATE SET\s+password_hash/);
});
