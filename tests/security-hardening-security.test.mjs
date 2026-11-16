import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('assignment schema is delivered only through the migration pipeline', async () => {
  const migrationNames = await readdir(new URL('database/migrations/', root));
  const migrationSource = await Promise.all(
    migrationNames.filter((name) => name.endsWith('.sql')).map((name) => source(`database/migrations/${name}`))
  );
  assert.ok(migrationSource.some((sql) => sql.includes('assignment_submissions')));
  assert.equal(migrationNames.includes('004_assignment_system.sql'), true);

  const routeNames = await readdir(new URL('app/api/admin/migrate/', root)).catch(() => []);
  assert.equal(routeNames.includes('route.ts'), false);
});

test('assignment uploads require bounded PDF content and cleanup-safe persistence', async () => {
  const studentRoute = await source('app/api/student/assignments/[id]/submit/route.ts');
  const staffRoute = await source('app/api/admin/assignments/[id]/file/route.ts');
  const uploadValidation = await source('app/lib/upload-validation.ts');
  for (const route of [studentRoute, staffRoute]) {
    assert.match(route, /hasAllowedContentLength/);
    assert.match(route, /byteLength/);
  }
  assert.match(uploadValidation, /pdfSignature/);
  assert.match(studentRoute, /storage\.delete\(storageKey\)/);
  assert.doesNotMatch(studentRoute, /email\.replace\(\/\[\^a-z0-9\]\//);
});

test('password reset and verification resend do not leak errors or lack request throttles', async () => {
  const reset = await source('app/api/auth/reset-password/route.ts');
  const resend = await source('app/api/auth/resend-code/route.ts');
  assert.match(reset, /requireSameOrigin\(request\)/);
  assert.match(reset, /\\d\{6\}/);
  assert.doesNotMatch(reset, /error: `[^`]*\$\{msg\}/);
  assert.match(resend, /checkRateLimit\('resend-verification-ip', getClientIp\(request\)/);
});

test('verification, video completion, and enrollment mutations have request limits', async () => {
  const verification = await source('app/api/auth/verify-email/route.ts');
  const completion = await source('app/api/videos/[id]/complete/route.ts');
  const enrollment = await source('app/api/enrollments/route.ts');
  const examStart = await source('app/api/exams/[id]/start/route.ts');
  assert.match(verification, /checkRateLimit\('verify-email-ip', getClientIp\(request\)/);
  assert.match(completion, /'video-complete'/);
  assert.match(completion, /requestBodyWithinLimit/);
  assert.match(enrollment, /checkRateLimit\('enrollment'/);
  assert.match(examStart, /checkRateLimit\('exam-start'/);
});

test('signed payment callbacks require an exact safe amount', async () => {
  const crypto = await source('app/lib/fawaterak-crypto.ts');
  const webhook = await source('app/api/payments/fawaterak/webhook/route.ts');
  assert.match(crypto, /Number\.isSafeInteger\(minorUnits\)/);
  assert.match(webhook, /paidAmountMinor !== paymentIntent\.amountMinor/);
});

test('exam start is an explicit mutation and expiration is claimed atomically', async () => {
  const route = await source('app/api/exams/[id]/route.ts');
  const sessions = await source('app/lib/exam-session.ts');
  const startRoute = await source('app/api/exams/[id]/start/route.ts').catch(() => '');
  assert.doesNotMatch(route, /startOrResumeExamSession/);
  assert.match(startRoute, /startOrResumeExamSession/);
  assert.match(sessions, /UPDATE exam_sessions SET status = 'expired'[\s\S]*RETURNING/);
});

test('production rate limits, audit identity, and observability redact sensitive values', async () => {
  const env = await source('app/lib/env.ts');
  const rateLimit = await source('app/lib/rate-limit.ts');
  const audit = await source('app/lib/audit.ts');
  const observability = await source('app/lib/observability.ts');
  assert.match(env, /TRUSTED_PROXY_IP_HEADER/);
  assert.match(rateLimit, /untrusted-client/);
  assert.match(audit, /getClientIp/);
  assert.match(observability, /access_token/);
  assert.match(observability, /client_secret/);
});

test('embed framing policy and production configuration validation are consistent', async () => {
  const config = await source('next.config.ts');
  assert.match(config, /assertPlatformEnv/);
  assert.match(config, /embedContentSecurityPolicy/);
  assert.match(config, /frame-ancestors 'self'/);
});

test('CI blocks high-severity dependency findings and uses immutable action references', async () => {
  const ci = await source('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /npm audit[^\n]*\|\| true/);
  assert.match(ci, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(ci, /permissions:\s*\n\s*contents:\s*read/);
});

test('repository hygiene ignores private credential file formats', async () => {
  const gitignore = await source('.gitignore');
  assert.match(gitignore, /\*\.key/);
  assert.match(gitignore, /\*\.p12/);
  assert.match(gitignore, /\*\.pfx/);
});

test('admin assignment form components are stable across renders', async () => {
  const assignments = await source('app/components/admin/domains/AssignmentsManagerView.tsx');
  assert.match(assignments, /function AssignmentFormFields/);
  assert.doesNotMatch(assignments, /const AssignmentFormFields =/);
});

test('transactional email templates escape untrusted HTML values', async () => {
  const email = await source('app/lib/email.ts');
  assert.match(email, /function escapeHtml/);
  assert.match(email, /escapeHtml\(template\.studentName\)/);
  assert.match(email, /escapeHtml\(template\.courseTitle\)/);
  assert.match(email, /escapeHtml\(template\.resetUrl\)/);
});

test('payment amounts reject unsafe minor-unit values', async () => {
  const { amountToMinorUnits } = await import('../app/lib/fawaterak-crypto.ts');
  assert.equal(amountToMinorUnits(90071992547409.91), null);
});
