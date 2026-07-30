import { performance } from 'node:perf_hooks';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3000';
const stages = (process.argv[3] || '25,50,100')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const durationMs = Number(process.argv[4] || 8000);
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) throw new Error('DATABASE_URL is required');

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

async function login(path, email, passwords) {
  for (const password of passwords) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      // This is a local script (not a browser), so it has no Origin header.
      // The application accepts an absent Origin for non-browser API clients.
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) continue;
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error(`No session cookie returned from ${path}`);
    return cookie;
  }
  throw new Error(`Unable to log in test account at ${path}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const course = await client.query(
  "SELECT id FROM courses WHERE title LIKE 'Edited E2E Course %' ORDER BY created_at DESC LIMIT 1"
);
if (!course.rows[0]) {
  await client.end();
  throw new Error('E2E test data is required before running the all-pages load test');
}

const studentEmail = 'load-test-student@example.test';
const staffEmail = 'load-test-staff@example.test';
const studentPassword = 'LoadTestStudent!2026';
const staffPassword = 'LoadTestStaff!2026';
const now = Date.now();
const createHash = (password) => {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256').toString('hex'),
  };
};
const studentCredentials = createHash(studentPassword);
const staffCredentials = createHash(staffPassword);
await client.query(
  `INSERT INTO users (email, name, grade, role, email_verified, password_hash, password_salt,
   password_iterations, created_at, updated_at)
   VALUES ($1, 'Load Test Student', 'تالتة ثانوي', 'student', 1, $2, $3, 100000, $4, $4)
   ON CONFLICT (email) DO UPDATE SET email_verified = 1, password_hash = EXCLUDED.password_hash,
   password_salt = EXCLUDED.password_salt, password_iterations = 100000, failed_attempts = 0,
   locked_until = NULL, updated_at = EXCLUDED.updated_at`,
  [studentEmail, studentCredentials.hash, studentCredentials.salt, now]
);
await client.query('DELETE FROM enrollments WHERE user_email = $1', [studentEmail]);
await client.query(
  `INSERT INTO enrollments (id, user_email, course_id, status, created_at, updated_at)
   VALUES ($1, $2, $3, 'approved', $4, $4)`,
  [randomUUID(), studentEmail, course.rows[0].id, now]
);
await client.query(
  `INSERT INTO staff_users (email, name, role, permissions, password_hash, password_salt,
   password_iterations, active, failed_attempts, created_by, created_at, updated_at)
   VALUES ($1, 'Load Test Staff', 'teacher', '[]', $2, $3, 100000, 1, 0, 'load-test', $4, $4)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
   password_salt = EXCLUDED.password_salt, password_iterations = 100000, active = 1,
   failed_attempts = 0, locked_until = NULL, updated_at = EXCLUDED.updated_at`,
  [staffEmail, staffCredentials.hash, staffCredentials.salt, now]
);
await client.end();

// Log in sequentially so the application's abuse protection does not treat the
// two setup requests as a burst from one IP address.
const studentCookie = await login('/api/auth/login', studentEmail, [studentPassword]);
const staffCookie = await login('/api/staff/login', staffEmail, [staffPassword]);

const targets = [
  ...['/', '/courses', '/about', '/contact', '/privacy-policy', '/login', '/register'].map((path) => ({
    name: path,
    path,
  })),
  ...[
    '/dashboard',
    '/account',
    `/course/${encodeURIComponent(course.rows[0].id)}`,
    `/learn/${encodeURIComponent(course.rows[0].id)}`,
    '/api/dashboard',
  ].map((path) => ({ name: path, path, cookie: studentCookie })),
  ...['/admin', '/api/admin/bootstrap'].map((path) => ({ name: path, path, cookie: staffCookie })),
];

async function runStage(concurrency) {
  const endsAt = performance.now() + durationMs;
  const totals = new Map(targets.map((target) => [target.name, { requests: 0, errors: 0, latencies: [] }]));

  async function virtualUser(id) {
    let requestNumber = 0;
    while (performance.now() < endsAt) {
      const target = targets[(id + requestNumber) % targets.length];
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const total = totals.get(target.name);
      try {
        const response = await fetch(`${baseUrl}${target.path}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            connection: 'keep-alive',
            'user-agent': 'englizeka-all-pages-load-test',
            ...(target.cookie ? { cookie: target.cookie } : {}),
          },
        });
        await response.arrayBuffer();
        if (!response.ok) total.errors += 1;
      } catch {
        total.errors += 1;
      } finally {
        clearTimeout(timeout);
        total.requests += 1;
        total.latencies.push(performance.now() - startedAt);
        requestNumber += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, id) => virtualUser(id)));
  return {
    concurrency,
    pages: [...totals.entries()].map(([page, total]) => {
      total.latencies.sort((left, right) => left - right);
      return {
        page,
        requests: total.requests,
        errors: total.errors,
        errorRate: total.requests ? (total.errors / total.requests) * 100 : 0,
        p95Ms: percentile(total.latencies, 0.95),
      };
    }),
  };
}

for (const concurrency of stages) {
  process.stdout.write(`${JSON.stringify(await runStage(concurrency))}\n`);
}
