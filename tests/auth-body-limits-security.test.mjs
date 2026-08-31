import assert from 'node:assert/strict';
import test from 'node:test';

test('public auth routes enforce 32 KiB body limits and reject oversized payloads with 413', async () => {
  const routes = [
    { name: 'login', method: 'POST', handler: 'POST', path: '../app/api/auth/login/route.ts', url: 'https://example.test/api/auth/login' },
    { name: 'forgot-password', method: 'POST', handler: 'POST', path: '../app/api/auth/forgot-password/route.ts', url: 'https://example.test/api/auth/forgot-password' },
    { name: 'resend-code', method: 'POST', handler: 'POST', path: '../app/api/auth/resend-code/route.ts', url: 'https://example.test/api/auth/resend-code' },
    { name: 'verify-email', method: 'POST', handler: 'POST', path: '../app/api/auth/verify-email/route.ts', url: 'https://example.test/api/auth/verify-email' },
    { name: 'verify-code', method: 'POST', handler: 'POST', path: '../app/api/auth/verify-code/route.ts', url: 'https://example.test/api/auth/verify-code' },
    { name: 'staff-login', method: 'POST', handler: 'POST', path: '../app/api/staff/login/route.ts', url: 'https://example.test/api/staff/login' },
    { name: 'reset-password', method: 'POST', handler: 'POST', path: '../app/api/auth/reset-password/route.ts', url: 'https://example.test/api/auth/reset-password' },
    { name: 'account-deletion', method: 'DELETE', handler: 'DELETE', path: '../app/api/users/me/route.ts', url: 'https://example.test/api/users/me' },
  ];

  for (const { name, method, handler, path, url } of routes) {
    const route = await import(path);
    const handle = route[handler];

    // 1. Oversized header (e.g. 35 KiB header)
    const oversizedReq = new Request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': '35840',
        origin: 'https://example.test',
      },
      body: JSON.stringify({ data: 'x'.repeat(100) }),
    });

    const res = await handle(oversizedReq);
    assert.equal(res.status, 413, `${name} should return 413 on oversized content-length header`);
    const json = await res.json();
    assert.equal(json.error, 'حجم الطلب غير صالح');

    // 2. Stream-level oversized payload (body stream > 32 KiB)
    const largeBody = JSON.stringify({ data: 'x'.repeat(33 * 1024) });
    const streamedOversizedReq = new Request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(largeBody)),
        origin: 'https://example.test',
      },
      body: largeBody,
    });

    const streamRes = await handle(streamedOversizedReq);
    assert.equal(streamRes.status, 413, `${name} should return 413 on stream exceeding 32 KiB`);
  }
});
