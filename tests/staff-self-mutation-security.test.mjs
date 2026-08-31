import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

class StaffDatabase {
  updates = [];
  sessionRevocations = [];

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const database = this;
    return new (class {
      bindings = [];

      bind(...bindings) {
        this.bindings = bindings;
        return this;
      }

      async first() {
        if (sql.includes('FROM staff_sessions s JOIN staff_users')) {
          return {
            expiresAt: Date.now() + 60_000,
            email: 'admin@example.test',
            name: 'Admin',
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
          };
        }
        return null;
      }

      async run() {
        if (/UPDATE staff_users\s+SET/.test(sql)) database.updates.push(this.bindings);
        if (sql.includes('DELETE FROM staff_sessions')) database.sessionRevocations.push(this.bindings);
        return { success: true, meta: { changes: 1 }, results: [] };
      }
    })();
  }
}

function request(body) {
  return new Request('https://example.test/api/admin/staff/admin%40example.test', {
    method: 'PATCH',
    headers: {
      cookie: 'englizeka_staff=session-token',
      origin: 'https://example.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('staff can change their own password without changing account status or role', async () => {
  const db = new StaffDatabase();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };
  const { PATCH } = await import('../app/api/admin/staff/[email]/route.ts');

  const response = await PATCH(request({ password: 'ValidPassword!2026' }), {
    params: Promise.resolve({ email: 'admin@example.test' }),
  });

  assert.equal(response.status, 200);
  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].at(-1), 'admin@example.test');
  assert.equal(db.sessionRevocations.length, 1);
});

test('staff cannot demote their own account', async () => {
  const db = new StaffDatabase();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };
  const { PATCH } = await import('../app/api/admin/staff/[email]/route.ts');

  const response = await PATCH(request({ role: 'assistant', active: true }), {
    params: Promise.resolve({ email: 'admin@example.test' }),
  });

  assert.equal(response.status, 403);
  assert.equal(db.updates.length, 0);
});

test('staff cannot suspend their own account', async () => {
  const db = new StaffDatabase();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };
  const { PATCH } = await import('../app/api/admin/staff/[email]/route.ts');

  const response = await PATCH(request({ role: 'teacher', active: false }), {
    params: Promise.resolve({ email: 'admin@example.test' }),
  });

  assert.equal(response.status, 403);
  assert.equal(db.updates.length, 0);
});
