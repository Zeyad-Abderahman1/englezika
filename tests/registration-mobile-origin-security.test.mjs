import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { requireSameOrigin } from '../app/lib/security.ts';
import { POST as registerHandler } from '../app/api/auth/register/route.ts';

function fakeDatabase() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes('INSERT INTO rate_limits')) {
            return { count: 1, resetAt: Date.now() + 60_000 };
          }
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((s) => s.run()));
    },
  };
}

const origNodeEnv = process.env.NODE_ENV;
const origAppUrl = process.env.APP_URL;

afterEach(() => {
  if (origNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = origNodeEnv;

  if (origAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = origAppUrl;

  delete globalThis.__ENGLIZEKA_ENV__;
});


describe('mobile student registration origin & CSRF security', () => {
  test('valid mobile registration request from https://englezika.com is accepted behind Nginx reverse proxy', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_URL; // aaPanel production server without explicit APP_URL

    const mobileRequest = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'https://englezika.com',
        referer: 'https://englezika.com/register',
        host: 'englezika.com',
        'x-forwarded-host': 'englezika.com',
        'x-forwarded-proto': 'https',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      },
    });

    const error = requireSameOrigin(mobileRequest);
    assert.equal(error, null, 'Valid mobile request from https://englezika.com must not be blocked');
  });

  test('valid mobile registration request from https://www.englezika.com is accepted', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://englezika.com';

    const mobileRequest = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'https://www.englezika.com',
        referer: 'https://www.englezika.com/register',
        host: 'www.englezika.com',
        'x-forwarded-host': 'www.englezika.com',
        'x-forwarded-proto': 'https',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      },
    });

    const error = requireSameOrigin(mobileRequest);
    assert.equal(error, null, 'Valid mobile request from www.englezika.com must be accepted');
  });

  test('invalid foreign Origin rejected with 403 and Arabic forbidden error', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://englezika.com';

    const foreignOrigins = [
      'https://evil.com',
      'https://attacker.example.org',
      'https://englezika.com.attacker.com',
      'https://fake-englezika.com',
      'http://englezika.com', // plain HTTP must be rejected in production
    ];

    for (const origin of foreignOrigins) {
      const request = new Request('http://127.0.0.1:3000/api/auth/register', {
        method: 'POST',
        headers: {
          origin,
          host: 'englezika.com',
          'x-forwarded-host': 'englezika.com',
          'x-forwarded-proto': 'https',
        },
      });

      const response = requireSameOrigin(request);
      assert.ok(response !== null, `Foreign origin ${origin} must be rejected`);
      assert.equal(response.status, 403);
      const data = await response.json();
      assert.equal(data.error, 'طلب غير مسموح');
    }
  });

  test('missing origin handled safely via referer fallback', () => {
    process.env.NODE_ENV = 'production';

    // Mobile WebKit / in-app browser omitting origin header but sending referer
    const requestWithReferer = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        referer: 'https://englezika.com/register',
        host: 'englezika.com',
        'x-forwarded-host': 'englezika.com',
        'x-forwarded-proto': 'https',
      },
    });

    const error = requireSameOrigin(requestWithReferer);
    assert.equal(error, null, 'Safe referer must allow registration when origin is omitted');
  });

  test('origin "null" handled safely via referer fallback or rejected when foreign/absent', async () => {
    process.env.NODE_ENV = 'production';

    // Privacy sandbox with legitimate referer
    const sandboxValid = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'null',
        referer: 'https://englezika.com/register',
      },
    });
    assert.equal(requireSameOrigin(sandboxValid), null);

    // Sandboxed iframe on attacker page with foreign referer
    const sandboxAttacker = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'null',
        referer: 'https://attacker.com/evil',
      },
    });
    const attackRes = requireSameOrigin(sandboxAttacker);
    assert.ok(attackRes !== null);
    assert.equal(attackRes.status, 403);
    const attackData = await attackRes.json();
    assert.equal(attackData.error, 'طلب غير مسموح');

    // Sandboxed iframe with no referer
    const sandboxNoReferer = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'null',
      },
    });
    const noRefRes = requireSameOrigin(sandboxNoReferer);
    assert.ok(noRefRes !== null);
    assert.equal(noRefRes.status, 403);
  });

  test('malformed origin is safely rejected', async () => {
    process.env.NODE_ENV = 'production';

    const malformedRequest = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'invalid-url-origin',
      },
    });

    const error = requireSameOrigin(malformedRequest);
    assert.ok(error !== null);
    assert.equal(error.status, 403);
    const data = await error.json();
    assert.equal(data.error, 'طلب غير مسموح');
  });

  test('registration endpoint POST route is still protected from CSRF', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://englezika.com';

    // Simulated cross-origin CSRF attempt from malicious site
    const csrfRequest = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'https://attacker-bank.com',
        referer: 'https://attacker-bank.com/exploit.html',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryX',
      },
    });

    const response = await registerHandler(csrfRequest);
    assert.equal(response.status, 403, 'CSRF attempt must be blocked with 403');
    const body = await response.json();
    assert.equal(body.error, 'طلب غير مسموح', 'CSRF attempt must return طلب غير مسموح');
  });

  test('registration endpoint POST route accepts valid mobile request', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://englezika.com';
    globalThis.__ENGLIZEKA_ENV__ = {
      DB: fakeDatabase(),
    };

    // Simulated mobile request to register endpoint without multipart body
    // (Should pass requireSameOrigin check and reach content-type validation, NOT 403)
    const mobileRequest = new Request('http://127.0.0.1:3000/api/auth/register', {
      method: 'POST',
      headers: {
        origin: 'https://englezika.com',
        referer: 'https://englezika.com/register',
        host: 'englezika.com',
        'x-forwarded-host': 'englezika.com',
        'x-forwarded-proto': 'https',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      },
    });

    const response = await registerHandler(mobileRequest);
    // Origin check passed, so the response is NOT 403 'طلب غير مسموح'
    assert.notEqual(
      response.status,
      403,
      'Valid mobile request must pass origin check and not return 403'
    );
    const body = await response.json();
    assert.notEqual(body.error, 'طلب غير مسموح');
  });
});
