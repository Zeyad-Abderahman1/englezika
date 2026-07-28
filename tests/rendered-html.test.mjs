import assert from 'node:assert/strict';
import test from 'node:test';

async function render(path = '/', requestHeaders = {}) {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('test', `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: 'text/html', ...requestHeaders },
    }),
    {
      ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({}),
          }),
        }),
        batch: async () => [],
      },
      VIDEOS: {
        head: async () => null,
        get: async () => null,
        put: async () => null,
        delete: async () => null,
      },
      VERIFICATION_SECRET: 'mock-test-verification-secret-32-chars-long',
      GMAIL_USER: 'mailer@example.test',
      GMAIL_APP_PASSWORD: 'test-only-app-password',
      EMAIL_TEST_MODE: 'false',
      INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
      INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
      INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
      INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
      INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
    },
    { waitUntil() {}, passThroughOnException() {} }
  );
}

test('server-renders the Englizeka home page', async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Englizeka/);
  assert.match(html, /افهم الإنجليزي/);
  assert.match(html, /الكورسات اللي هتفرق معاك/);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /href="\/dashboard"/);
});

test('server-renders primary public routes', async () => {
  for (const path of ['/courses', '/about', '/contact', '/login', '/register', '/staff/login']) {
    const response = await render(path);
    assert.equal(response.status, 200, `${path} should render`);
  }
});

test('anonymous visitors see only public navigation', async () => {
  const publicResponse = await render('/');
  const publicHtml = await publicResponse.text();
  assert.match(publicHtml, /تسجيل الدخول/);
  assert.doesNotMatch(publicHtml, /مساحتي التعليمية|لوحة الإدارة/);
  assert.match(publicHtml, /حساب جديد/);
});

test('protected pages and APIs reject anonymous access', async () => {
  const account = await render('/account');
  assert.equal(account.status, 307);
  assert.match(account.headers.get('location') ?? '', /\/login\?return_to=%2Faccount$/);
  const admin = await render('/admin');
  assert.equal(admin.status, 307);
  assert.match(admin.headers.get('location') ?? '', /staff\/login/);

  const adminApi = await render('/api/admin/bootstrap');
  assert.equal(adminApi.status, 401);
  const accountApi = await render('/api/dashboard');
  assert.equal(accountApi.status, 401);
  const videoResolve = await render('/api/videos/example-video/resolve');
  assert.equal(videoResolve.status, 401);
  const videoEmbed = await render('/api/videos/example-video/embed?token=invalid');
  assert.equal(videoEmbed.status, 401);
});
