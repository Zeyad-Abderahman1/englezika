import assert from 'node:assert/strict';
import test from 'node:test';
import { isSecureRequest } from '../app/lib/security.ts';
import { studentSessionCookie } from '../app/lib/student-session.ts';
import { staffCookie } from '../app/lib/staff-auth.ts';

test('isSecureRequest returns true when x-forwarded-proto is https on an http request', () => {
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const req = new Request('http://127.0.0.1:3000/api/auth/login', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(isSecureRequest(req), true);
  } finally {
    process.env.NODE_ENV = origNodeEnv;
  }
});

test('isSecureRequest returns true when NODE_ENV is production even on http request without forwarded headers', () => {
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const req = new Request('http://127.0.0.1:3000/api/auth/login');
    assert.equal(isSecureRequest(req), true);
  } finally {
    process.env.NODE_ENV = origNodeEnv;
  }
});

test('isSecureRequest returns false on plain http in development', () => {
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const req = new Request('http://127.0.0.1:3000/api/auth/login');
    assert.equal(isSecureRequest(req), false);
  } finally {
    process.env.NODE_ENV = origNodeEnv;
  }
});

test('student and staff session cookies include Secure flag when isSecure is true', () => {
  const studentCookie = studentSessionCookie('test-token-1234567890', true, false);
  assert.ok(studentCookie.includes('; Secure'), 'Student cookie must include Secure attribute');
  assert.ok(studentCookie.includes('HttpOnly'), 'Student cookie must include HttpOnly');
  assert.ok(studentCookie.includes('SameSite=Lax'), 'Student cookie must include SameSite=Lax');

  const staff = staffCookie('test-staff-token-12345', Date.now() + 3600_000, true);
  assert.ok(staff.includes('; Secure'), 'Staff cookie must include Secure attribute');
  assert.ok(staff.includes('HttpOnly'), 'Staff cookie must include HttpOnly');
  assert.ok(staff.includes('SameSite=Strict'), 'Staff cookie must include SameSite=Strict');
});
