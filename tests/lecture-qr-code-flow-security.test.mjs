import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  generateLectureQRToken,
  hashLectureQRToken,
  normalizeLectureQRToken,
  extractLectureQRToken,
  buildLectureQRUrl,
  getLectureQRCodeInfo,
  redeemLectureAccessCode,
  hasLectureAccess,
} from '../app/lib/lecture-access-codes.ts';
import { POST as handleInfoPost, GET as handleInfoGet } from '../app/api/student/qr/info/route.ts';
import { POST as handleRedeemPost } from '../app/api/student/qr/redeem/route.ts';

// In-memory test database strictly adhering to real PostgreSQL schema
function createTestDb(options = {}) {
  const tables = {
    lecture_access_codes: [],
    student_video_access_grants: [],
    // Real schema: videos has NO description column
    videos: [
      { id: 'vid-101', course_id: 'crs-1', title: 'Lecture 1: Grammar Mastery' },
      { id: 'vid-102', course_id: 'crs-1', title: 'Lecture 2: Vocabulary Secrets' },
    ],
    // Real schema: courses has grade column, NOT stage column
    courses: [
      { id: 'crs-1', title: 'Third Secondary English 2026', grade: 'الصف الثالث الثانوي' },
    ],
    enrollments: [],
  };

  return {
    tables,
    prepare(sql) {
      if (options.shouldThrow) {
        throw new Error('Database connection failure');
      }

      // Real schema enforcement: fail if query references columns that do not exist in Postgres
      if (sql.includes('v.description') || sql.includes('videos.description')) {
        throw new Error('error: column v.description does not exist');
      }
      if (sql.includes('c.stage') || sql.includes('courses.stage')) {
        throw new Error('error: column c.stage does not exist');
      }

      return {
        bind(...args) {
          return {
            async first() {
              // 1. handleQRInfo lookup: lac joined with videos and courses
              if (sql.includes('FROM lecture_access_codes lac') && sql.includes('WHERE lac.code_hash = ?')) {
                const [hash] = args;
                const codeRow = tables.lecture_access_codes.find((r) => r.code_hash === hash);
                if (!codeRow) return null;
                const video = tables.videos.find((v) => v.id === codeRow.video_id);
                const course = tables.courses.find((c) => c.id === codeRow.course_id);
                return {
                  id: codeRow.id,
                  courseId: course?.id,
                  videoId: video?.id,
                  redeemedAt: codeRow.redeemed_at,
                  videoTitle: video?.title,
                  courseTitle: course?.title,
                  stage: course?.grade,
                };
              }

              // 2. hasLectureAccess
              if (sql.includes('SELECT 1') && sql.includes('FROM videos v') && sql.includes('student_video_access_grants g')) {
                const [videoId, email1, email2] = args;
                const hasGrant = tables.student_video_access_grants.some(
                  (g) => g.video_id === videoId && g.student_email.toLowerCase() === email2.toLowerCase()
                );
                const hasEnrollment = tables.enrollments.some(
                  (e) => e.user_email.toLowerCase() === email1.toLowerCase() && e.status === 'approved'
                );
                return hasGrant || hasEnrollment ? { 1: 1 } : null;
              }

              // 3. check already_used in redeem
              if (sql.includes('SELECT redeemed_at AS redeemedAt FROM lecture_access_codes WHERE code_hash = ?')) {
                const [hash] = args;
                const row = tables.lecture_access_codes.find((r) => r.code_hash === hash);
                return row ? { redeemedAt: row.redeemed_at } : null;
              }

              // 4. Atomic redeem CTE simulated
              if (sql.includes('WITH candidate AS')) {
                const [codeHash, grantId, studentEmail, now1, emailUpdate, now2] = args;
                const codeRow = tables.lecture_access_codes.find(
                  (r) => r.code_hash === codeHash && r.redeemed_at === null
                );
                if (!codeRow) return null;

                // Mark claimed
                codeRow.redeemed_at = now2;
                codeRow.redeemed_by_student_email = emailUpdate;

                // Grant access
                tables.student_video_access_grants.push({
                  id: grantId,
                  student_email: studentEmail,
                  video_id: codeRow.video_id,
                  source: 'one_time_code',
                  source_access_code_id: codeRow.id,
                  created_at: now1,
                });

                const video = tables.videos.find((v) => v.id === codeRow.video_id);
                const course = tables.courses.find((c) => c.id === codeRow.course_id);

                return {
                  courseId: course?.id,
                  courseTitle: course?.title,
                  videoId: video?.id,
                  videoTitle: video?.title,
                };
              }

              return null;
            },
            async all() {
              return [];
            },
            async run() {
              return { changes: 1 };
            },
          };
        },
      };
    },
  };
}

test('1. generateLectureQRToken produces high-entropy, unique base64url tokens with eqr_ prefix', () => {
  const tokens = new Set();
  for (let i = 0; i < 500; i++) {
    const token = generateLectureQRToken();
    assert.match(token, /^eqr_[A-Za-z0-9_-]{32}$/, 'Token must match eqr_ prefix followed by 32 base64url chars');
    assert.equal(tokens.has(token), false, 'Tokens must be cryptographically unique');
    tokens.add(token);
  }
  assert.equal(tokens.size, 500);
});

test('2. buildLectureQRUrl generates proper canonical redemption URLs with hash fragment', () => {
  const token = 'eqr_example_secure_token_12345';

  // Canonical APP_URL authoritative priority test (production behind Nginx/PM2)
  const prevAppUrl = process.env.APP_URL;
  const prevInjected = globalThis.__ENGLIZEKA_ENV__;
  try {
    process.env.APP_URL = 'https://englezika.com';
    if (globalThis.__ENGLIZEKA_ENV__) {
      globalThis.__ENGLIZEKA_ENV__.APP_URL = 'https://englezika.com';
    }

    const canonicalUrl = buildLectureQRUrl(token, 'http://127.0.0.1:3000');
    assert.equal(
      canonicalUrl,
      'https://englezika.com/redeem#eqr_example_secure_token_12345',
      'Canonical APP_URL must always take precedence over request/internal baseOrigin'
    );
    assert.doesNotMatch(
      canonicalUrl,
      /127\.0\.0\.1|localhost/,
      'QR code URL must never contain localhost or 127.0.0.1 when APP_URL is configured'
    );

    // Fallback when APP_URL is absent
    delete process.env.APP_URL;
    if (globalThis.__ENGLIZEKA_ENV__) {
      delete globalThis.__ENGLIZEKA_ENV__.APP_URL;
    }

    const fallbackUrl = buildLectureQRUrl(token, 'http://127.0.0.1:3000');
    assert.equal(
      fallbackUrl,
      'http://127.0.0.1:3000/redeem#eqr_example_secure_token_12345',
      'baseOrigin should serve as fallback when APP_URL is empty'
    );

    const relativeUrl = buildLectureQRUrl(token, '');
    assert.equal(relativeUrl, '/redeem#eqr_example_secure_token_12345');
  } finally {
    if (prevAppUrl !== undefined) {
      process.env.APP_URL = prevAppUrl;
    } else {
      delete process.env.APP_URL;
    }
    if (prevInjected !== undefined) {
      globalThis.__ENGLIZEKA_ENV__ = prevInjected;
    }
  }
});

test('3. normalizeLectureQRToken strictly validates tokens and rejects malformed inputs', () => {
  const validToken = generateLectureQRToken();
  assert.equal(normalizeLectureQRToken(validToken), validToken);
  assert.equal(normalizeLectureQRToken(`  ${validToken}  `), validToken);

  // Rejections
  assert.equal(normalizeLectureQRToken(''), null);
  assert.equal(normalizeLectureQRToken(null), null);
  assert.equal(normalizeLectureQRToken(undefined), null);
  assert.equal(normalizeLectureQRToken(12345), null);
  assert.equal(normalizeLectureQRToken('short'), null);
  assert.equal(normalizeLectureQRToken('<script>alert(1)</script>'), null);
  assert.equal(normalizeLectureQRToken('eqr_with_spaces in the middle'), null);
  // Strictly rejects legacy manual text codes
  assert.equal(normalizeLectureQRToken('ENG-ABCDE-12345-67890-ABCDE-FGHIJ-KLMNO'), null);
  assert.equal(normalizeLectureQRToken('ENG1234567890ABCDEFGHIJKLMNO'), null);
});

test('4. extractLectureQRToken safely parses canonical hash, mobile percent-encoded URLs, query params, and manual entry', () => {
  const token = 'eqr_abcdefghijklmnopqrstuvwxyz012345';

  // Canonical hash fragment
  assert.equal(extractLectureQRToken(`#${token}`), token);
  assert.equal(extractLectureQRToken(`https://englezika.com/redeem#${token}`), token);

  // Mobile scanner percent-encoded hash (%23)
  assert.equal(extractLectureQRToken(`%23${token}`), token);
  assert.equal(extractLectureQRToken(`https://englezika.com/redeem%23${token}`), token);
  assert.equal(extractLectureQRToken(`/redeem%23${token}`), token);

  // Hash with key prefixes (#token= or #code=)
  assert.equal(extractLectureQRToken(`#token=${token}`), token);
  assert.equal(extractLectureQRToken(`https://englezika.com/redeem#token=${token}`), token);
  assert.equal(extractLectureQRToken(`#code=${token}`), token);

  // Query parameter fallback
  assert.equal(extractLectureQRToken(`?token=${token}`), token);
  assert.equal(extractLectureQRToken(`https://englezika.com/redeem?token=${token}`), token);
  assert.equal(extractLectureQRToken(`https://englezika.com/redeem?code=${token}`), token);

  // Path-based fallback
  assert.equal(extractLectureQRToken(`/redeem/${token}`), token);

  // URL-encoded characters in token (e.g. %5F for underscore)
  const encodedToken = token.replace('_', '%5F');
  assert.equal(extractLectureQRToken(`#${encodedToken}`), token);

  // Manual token entry (direct token string with or without whitespace)
  assert.equal(extractLectureQRToken(token), token);
  assert.equal(extractLectureQRToken(`   ${token}   `), token);

  // Invalid inputs correctly return null
  assert.equal(extractLectureQRToken(''), null);
  assert.equal(extractLectureQRToken(null), null);
  assert.equal(extractLectureQRToken('invalid_text'), null);
  assert.equal(extractLectureQRToken('https://englezika.com/redeem#invalid'), null);
  assert.equal(extractLectureQRToken('https://englezika.com/redeem?token=short'), null);
  assert.equal(extractLectureQRToken('ENG-ABCDE-12345-67890-ABCDE-FGHIJ-KLMNO'), null);
});

test('5. End-to-end QR code lifecycle: Generation -> Query Info -> Single-use Redemption -> Verify Access', async () => {
  const db = createTestDb();
  const token = generateLectureQRToken();
  const tokenHash = await hashLectureQRToken(token);

  // Teacher generates QR code in admin panel
  db.tables.lecture_access_codes.push({
    id: 'code-uuid-1',
    course_id: 'crs-1',
    video_id: 'vid-101',
    code_hash: tokenHash,
    code_suffix: token.slice(-6),
    redeemed_at: null,
    redeemed_by_student_email: null,
    created_at: Date.now(),
  });

  // Student scans QR code with phone: frontend checks info prior to redemption
  const infoBefore = await getLectureQRCodeInfo(db, token);
  assert.equal(infoBefore.status, 'available');
  assert.equal(infoBefore.videoId, 'vid-101');
  assert.equal(infoBefore.videoTitle, 'Lecture 1: Grammar Mastery');
  assert.equal(infoBefore.courseId, 'crs-1');

  // Verify student has NO access yet
  const hasAccessBefore = await hasLectureAccess(db, 'student@example.com', 'vid-101');
  assert.equal(hasAccessBefore, false);

  // Student redeems QR code
  const redeemResult = await redeemLectureAccessCode(db, 'student@example.com', token);
  assert.equal(redeemResult.status, 'success');
  assert.equal(redeemResult.videoId, 'vid-101');
  assert.equal(redeemResult.courseId, 'crs-1');

  // Verify access is NOW GRANTED
  const hasAccessAfter = await hasLectureAccess(db, 'student@example.com', 'vid-101');
  assert.equal(hasAccessAfter, true);

  // Student tries to redeem the same QR code AGAIN -> REJECTED (already_used)
  const secondRedeem = await redeemLectureAccessCode(db, 'other_student@example.com', token);
  assert.equal(secondRedeem.status, 'already_used');

  // Querying info now reports already_used
  const infoAfter = await getLectureQRCodeInfo(db, token);
  assert.equal(infoAfter.status, 'already_used');
});

test('6. Non-existent QR tokens return invalid_token / invalid_code', async () => {
  const db = createTestDb();
  const fakeToken = generateLectureQRToken();

  const info = await getLectureQRCodeInfo(db, fakeToken);
  assert.equal(info.status, 'invalid_token');

  const redeem = await redeemLectureAccessCode(db, 'student@example.com', fakeToken);
  assert.equal(redeem.status, 'invalid_code');
});

test('7. QR redemption URL encodes token strictly into URL hash fragment and never query string', () => {
  const token = generateLectureQRToken();
  const fullUrl = buildLectureQRUrl(token, 'https://englezika.com');
  const parsed = new URL(fullUrl);

  assert.equal(parsed.pathname, '/redeem');
  assert.equal(parsed.search, '', 'Query string must be completely empty');
  assert.equal(parsed.hash, `#${token}`, 'Hash fragment must contain the exact token');
  assert.match(parsed.hash, /^#eqr_[A-Za-z0-9_-]{32}$/);
});

test('8. Student QR redemption endpoint route requires token and rejects code', async () => {
  const redeemRouteContent = await readFile(
    new URL('../app/api/student/qr/redeem/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(redeemRouteContent, /body\.token/);
  assert.doesNotMatch(redeemRouteContent, /body\.code/);
  assert.match(redeemRouteContent, /normalizeLectureQRToken\(body\.token\)/);
});

test('9. POST /api/student/qr/info returns valid lecture details using real schema (courses.grade AS stage, no videos.description)', async () => {
  const db = createTestDb();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const token = generateLectureQRToken();
  const tokenHash = await hashLectureQRToken(token);

  db.tables.lecture_access_codes.push({
    id: 'code-uuid-real-schema',
    course_id: 'crs-1',
    video_id: 'vid-101',
    code_hash: tokenHash,
    code_suffix: token.slice(-6),
    redeemed_at: null,
    redeemed_by_student_email: null,
    created_at: Date.now(),
  });

  const request = new Request('http://localhost:3000/api/student/qr/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const response = await handleInfoPost(request);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.isRedeemed, false);
  assert.equal(data.video.id, 'vid-101');
  assert.equal(data.video.title, 'Lecture 1: Grammar Mastery');
  assert.equal(data.video.courseTitle, 'Third Secondary English 2026');
  // stage correctly mapped from courses.grade
  assert.equal(data.video.stage, 'الصف الثالث الثانوي');
  // description safely null since videos table has no description column
  assert.equal(data.video.description, null);
});

test('10. GET /api/student/qr/info returns valid lecture details from query string', async () => {
  const db = createTestDb();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const token = generateLectureQRToken();
  const tokenHash = await hashLectureQRToken(token);

  db.tables.lecture_access_codes.push({
    id: 'code-uuid-get-test',
    course_id: 'crs-1',
    video_id: 'vid-102',
    code_hash: tokenHash,
    code_suffix: token.slice(-6),
    redeemed_at: null,
    redeemed_by_student_email: null,
    created_at: Date.now(),
  });

  const request = new Request(`http://localhost:3000/api/student/qr/info?token=${encodeURIComponent(token)}`);
  const response = await handleInfoGet(request);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.video.id, 'vid-102');
  assert.equal(data.video.title, 'Lecture 2: Vocabulary Secrets');
});

test('11. POST /api/student/qr/info returns 404 for nonexistent valid-format token', async () => {
  const db = createTestDb();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const nonexistentToken = generateLectureQRToken();
  const request = new Request('http://localhost:3000/api/student/qr/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: nonexistentToken }),
  });

  const response = await handleInfoPost(request);
  assert.equal(response.status, 404);

  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'QR_NOT_FOUND');
});

test('12. POST /api/student/qr/info returns 409 for already-used token', async () => {
  const db = createTestDb();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const token = generateLectureQRToken();
  const tokenHash = await hashLectureQRToken(token);

  db.tables.lecture_access_codes.push({
    id: 'code-uuid-claimed',
    course_id: 'crs-1',
    video_id: 'vid-101',
    code_hash: tokenHash,
    code_suffix: token.slice(-6),
    redeemed_at: Date.now() - 60000,
    redeemed_by_student_email: 'first_student@example.com',
    created_at: Date.now() - 120000,
  });

  const request = new Request('http://localhost:3000/api/student/qr/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const response = await handleInfoPost(request);
  assert.equal(response.status, 409);

  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.isRedeemed, true);
  assert.equal(data.error, 'QR_ALREADY_USED');
  assert.equal(data.videoTitle, 'Lecture 1: Grammar Mastery');
});

test('13. POST /api/student/qr/info returns 400 for malformed token', async () => {
  const db = createTestDb();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db };

  const request = new Request('http://localhost:3000/api/student/qr/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'malformed_token_123' }),
  });

  const response = await handleInfoPost(request);
  assert.equal(response.status, 400);

  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'INVALID_QR_FORMAT');
});

test('14. POST /api/student/qr/info catches unexpected DB errors and returns safe JSON 500 without crashing', async () => {
  // DB configured to throw an unexpected database failure
  const faultyDb = createTestDb({ shouldThrow: true });
  globalThis.__ENGLIZEKA_ENV__ = { DB: faultyDb };

  const token = generateLectureQRToken();
  const request = new Request('http://localhost:3000/api/student/qr/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const response = await handleInfoPost(request);
  assert.equal(response.status, 500);

  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'DATABASE_ERROR');
  assert.match(data.message, /تعذر التحقق من بيانات رمز QR/);
});

test('15. POST /api/student/qr/redeem rejects unauthenticated requests with 401', async () => {
  const token = generateLectureQRToken();
  const request = new Request('http://localhost:3000/api/student/qr/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const response = await handleRedeemPost(request);
  assert.equal(response.status, 401);
});

test('16. Database query in /api/student/qr/info strictly matches PostgreSQL schema', async () => {
  const routeContent = await readFile(
    new URL('../app/api/student/qr/info/route.ts', import.meta.url),
    'utf8'
  );

  // Must not query v.description
  assert.doesNotMatch(routeContent, /v\.description/, 'Must not reference v.description');
  assert.doesNotMatch(routeContent, /videos\.description/, 'Must not reference videos.description');

  // Must not query c.stage (column is grade)
  assert.doesNotMatch(routeContent, /c\.stage\b/, 'Must not reference c.stage directly');
  assert.match(routeContent, /c\.grade\s+AS\s+stage/i, 'Must alias courses.grade as stage');
});

test('17. Frontend /redeem page contains direct manual token entry and mobile percent-encoding resilience', async () => {
  const redeemPageContent = await readFile(
    new URL('../app/redeem/page.tsx', import.meta.url),
    'utf8'
  );

  // Contains manual submission handler
  assert.match(redeemPageContent, /handleManualSubmit/);
  assert.match(redeemPageContent, /extractLectureQRToken/);

  // Contains manual input UI in State 1
  assert.match(redeemPageContent, /أو أدخل رمز الكارت يدويًا/);
  assert.match(redeemPageContent, /placeholder="مثال: eqr_\.\.\."/);

  // Contains mobile percent-encoded scanner support (%23)
  assert.match(redeemPageContent, /%23/);

  // Preserves strict token validation
  assert.match(redeemPageContent, /QR_TOKEN_REGEX = \/\^eqr_\[A-Za-z0-9_-\]\{24,80\}\$\//);
});
