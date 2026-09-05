import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class AtomicCodeDatabase {
  constructor(codeHash) {
    this.codeHash = codeHash;
  }

  redeemedAt = null;
  redeemedBy = null;
  grants = new Set();

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
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('WITH candidate AS')) {
          const [codeHash, , email, , , redeemedAt] = this.bindings;
          if (codeHash !== database.codeHash || database.redeemedAt !== null) return null;
          database.redeemedAt = redeemedAt;
          database.redeemedBy = email;
          database.grants.add(`${email}:video-1`);
          return {
            courseId: 'course-1',
            videoId: 'video-1',
            videoTitle: 'المحاضرة الأولى',
            courseTitle: 'الكورس',
          };
        }
        if (normalizedSql.startsWith('SELECT redeemed_at AS redeemedAt')) {
          return codeHashMatches(this.bindings[0], database.codeHash)
            ? { redeemedAt: database.redeemedAt }
            : null;
        }
        return null;
      }
    })();
  }
}

function codeHashMatches(left, right) {
  return typeof left === 'string' && left === right;
}

test('QR tokens use server cryptographic randomness, normalize safely, and hash deterministically', async () => {
  const {
    generateLectureQRToken,
    hashLectureQRToken,
    normalizeLectureQRToken,
  } = await import('../app/lib/lecture-access-codes.ts');

  // 1. Cryptographic uniqueness & entropy (24 bytes = 192 bits)
  const tokens = Array.from({ length: 256 }, generateLectureQRToken);
  assert.equal(new Set(tokens).size, tokens.length, 'All generated tokens must be cryptographically unique');

  for (const token of tokens) {
    assert.match(token, /^eqr_[A-Za-z0-9_-]{32}$/, 'Token must match eqr_ prefix followed by 32 base64url chars');
    assert.equal(normalizeLectureQRToken(token), token);
    assert.equal(normalizeLectureQRToken(`  ${token}  `), token);
  }

  // 2. Strict rejection of invalid, malformed, or legacy inputs
  assert.equal(normalizeLectureQRToken('wrong-token'), null);
  assert.equal(normalizeLectureQRToken(''), null);
  assert.equal(normalizeLectureQRToken(null), null);
  assert.equal(normalizeLectureQRToken(undefined), null);
  assert.equal(normalizeLectureQRToken('<script>alert(1)</script>'), null);
  assert.equal(normalizeLectureQRToken('eqr_short'), null);
  // Rejects obsolete manual text codes
  assert.equal(normalizeLectureQRToken('ENG-ABCDE-12345-67890-ABCDE-FGHIJ-KLMNO'), null);
  assert.equal(normalizeLectureQRToken('ENG1234567890ABCDEFGHIJKLMNO'), null);

  // 3. Deterministic SHA-256 hashing
  const normalized = normalizeLectureQRToken(tokens[0]);
  assert.ok(normalized);
  const hash1 = await hashLectureQRToken(normalized);
  const hash2 = await hashLectureQRToken(normalized);
  assert.equal(hash1, hash2, 'SHA-256 hash must be deterministic');
  assert.notEqual(hash1, normalized, 'Hash must not equal plaintext token');
  assert.match(hash1, /^[0-9a-f]{64}$/, 'Hash must be a 64-character lowercase hex string');

  // 4. Source code verification: uses CSPRNG and no Math.random()
  const source = await readFile(new URL('../app/lib/lecture-access-codes.ts', import.meta.url), 'utf8');
  assert.match(source, /randomBytes\(24\)/, 'Must use randomBytes(24) for cryptographic QR entropy');
  assert.doesNotMatch(source, /Math\.random/, 'Must not use Math.random');
});

test('50 concurrent database redemption attempts produce exactly one owner and one persistent grant', async () => {
  const {
    generateLectureQRToken,
    hashLectureQRToken,
    normalizeLectureQRToken,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');

  const token = generateLectureQRToken();
  const normalized = normalizeLectureQRToken(token);
  assert.ok(normalized);

  const tokenHash = await hashLectureQRToken(normalized);
  const database = new AtomicCodeDatabase(tokenHash);

  // 50 concurrent students attempting to redeem the exact same single-use token simultaneously
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      redeemLectureAccessCode(database, `student-${index}@example.test`, token)
    )
  );

  // Database atomicity: exactly 1 winner, exactly 49 already_used
  assert.equal(results.filter((result) => result.status === 'success').length, 1);
  assert.equal(results.filter((result) => result.status === 'already_used').length, 49);
  assert.equal(database.grants.size, 1);
  assert.equal(database.redeemedBy, [...database.grants][0].split(':')[0]);
});

test('migration stores only a unique hash and constrains one student/video grant', async () => {
  const migration = await readFile(
    new URL('../database/migrations/003_one_time_video_access_codes.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /code_hash TEXT UNIQUE NOT NULL/);
  assert.match(migration, /UNIQUE \(student_email, video_id\)/);
  assert.match(migration, /source_access_code_id TEXT UNIQUE/);
  assert.doesNotMatch(migration, /plaintext|plain_code|code_value/i);
});

test('routes require staff permission, student authentication, same-origin checks, and rate limits', async () => {
  // 1. Single QR generation route
  const singleQRRoute = await readFile(
    new URL('../app/api/admin/videos/[id]/qr/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(singleQRRoute, /apiStaff\(request, 'manage_videos'\)/);
  assert.match(singleQRRoute, /requireSameOrigin\(request\)/);
  assert.match(singleQRRoute, /SELECT id, course_id AS courseId FROM videos WHERE id = \?/);
  assert.match(singleQRRoute, /generateLectureQRToken\(\)/);
  assert.match(singleQRRoute, /hashLectureQRToken\(/);
  assert.match(singleQRRoute, /recordAuditLog\(/);

  // 2. Bulk QR generation route
  const bulkQRRoute = await readFile(
    new URL('../app/api/admin/qr/bulk/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(bulkQRRoute, /apiStaff\(request, 'manage_videos'\)/);
  assert.match(bulkQRRoute, /requireSameOrigin\(request\)/);
  assert.match(bulkQRRoute, /access_code_batches/);
  assert.match(bulkQRRoute, /lecture_access_codes/);

  // 3. QR PDF route
  const pdfRoute = await readFile(
    new URL('../app/api/admin/qr/pdf/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(pdfRoute, /apiStaff\(request, 'manage_videos'\)/);
  assert.match(pdfRoute, /requireSameOrigin\(request\)/);
  assert.match(pdfRoute, /PLAINTEXT_TOKENS_REQUIRED/);

  // 4. Student redemption route
  const redemptionRoute = await readFile(
    new URL('../app/api/student/qr/redeem/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(redemptionRoute, /apiVerifiedUser\(request\)/);
  assert.match(redemptionRoute, /lecture-code-account/);
  assert.match(redemptionRoute, /lecture-code-ip/);
  assert.match(redemptionRoute, /requireSameOrigin\(request\)/);
  assert.match(redemptionRoute, /normalizeLectureQRToken\(/);

  // 5. Student QR info pre-check route
  const infoRoute = await readFile(
    new URL('../app/api/student/qr/info/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(infoRoute, /normalizeLectureAccessCode\(rawToken\)/);
  assert.match(infoRoute, /c\.grade\s+AS\s+stage/i);
  assert.doesNotMatch(infoRoute, /v\.description/);
  assert.match(infoRoute, /DATABASE_ERROR/);
});

test('video authorization accepts the selected grant without unlocking another video or the course', async () => {
  const database = {
    prepare(sql) {
      return new (class {
        bindings = [];
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        }
        async first() {
          const normalizedSql = sql.replace(/\s+/g, ' ').trim();
          if (!normalizedSql.startsWith('SELECT v.id, v.course_id AS courseId')) return null;
          const videoId = this.bindings[2];
          return {
            id: videoId,
            courseId: 'course-1',
            sourceType: 'youtube',
            youtubeId: 'dQw4w9WgXcQ',
            durationSeconds: 120,
            title: 'Protected lesson',
            prerequisiteExamId: 'exam-1',
            minimumScore: 100,
            hasEnrollmentAccess: 0,
            hasIndividualGrant: videoId === 'video-1' ? 1 : 0,
          };
        }
      })();
    },
  };
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: database,
    VERIFICATION_SECRET: 'test-video-access-secret-that-is-at-least-24-characters',
  };
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');
  assert.equal((await authorizeVideoAccess('student@example.test', 'video-1')).ok, true);
  assert.equal((await authorizeVideoAccess('student@example.test', 'video-2')).ok, false);

  const learnPage = await readFile(new URL('../app/learn/[courseId]/page.tsx', import.meta.url), 'utf8');
  assert.match(learnPage, /grantedIds\.has\(video\.id\)/);
  assert.match(learnPage, /allowSequentialUnlock=\{Boolean\(enrollment\)\}/);
});

test('public student redemption endpoint enforces account rate limits and returns 429 response structure', async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const db = {
      counters: new Map(),
      prepare(sql) {
        const database = this;
        return new (class {
          bindings = [];
          bind(...bindings) {
            this.bindings = bindings;
            return this;
          }
          async first() {
            const normalizedSql = sql.replace(/\s+/g, ' ').trim();
            if (!normalizedSql.startsWith('INSERT INTO rate_limits')) return null;
            const [key, nextResetAt, resetCountAt, resetWindowAt] = this.bindings;
            const current = database.counters.get(key);
            const expired = current && current.resetAt <= resetCountAt;
            const next = {
              count: !current || expired ? 1 : current.count + 1,
              resetAt: !current || current.resetAt <= resetWindowAt ? nextResetAt : current.resetAt,
            };
            database.counters.set(key, next);
            return { ...next };
          }
        })();
      },
    };
    globalThis.__ENGLIZEKA_ENV__ = {
      DB: db,
      VERIFICATION_SECRET: 'test-rate-limit-secret-that-is-at-least-24-characters',
    };

    const { checkRateLimit, rateLimitResponse } = await import('../app/lib/rate-limit.ts');
    const testAccount = `test-ratelimit-${Date.now()}@example.test`;

    // Exactly 8 requests allowed within window
    for (let i = 0; i < 8; i++) {
      const check = await checkRateLimit('lecture-code-account', testAccount, 8, 15 * 60);
      assert.equal(check.allowed, true, `Request ${i + 1} of 8 must be allowed`);
    }

    // 9th request blocked by rate limiter
    const blocked = await checkRateLimit('lecture-code-account', testAccount, 8, 15 * 60);
    assert.equal(blocked.allowed, false, 'Request 9 exceeding limit must be blocked');
    assert.ok(blocked.resetAfterSeconds > 0);

    const res = rateLimitResponse(blocked.resetAfterSeconds, 'تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقًا.');
    assert.equal(res.status, 429);
    assert.ok(res.headers.get('retry-after'));
    const body = await res.json();
    assert.equal(body.retryAfter, blocked.resetAfterSeconds);
    assert.equal(body.error, 'تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقًا.');
  } finally {
    process.env.NODE_ENV = previousEnv;
  }
});
