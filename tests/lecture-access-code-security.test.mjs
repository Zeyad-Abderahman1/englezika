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
    // The statement stub needs a stable reference to its owning in-memory database.
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

test('codes use server cryptographic randomness, normalize safely, and hash deterministically', async () => {
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const codes = Array.from({ length: 256 }, generateLectureAccessCode);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^ENG(?:-[123456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}){6}$/);
    assert.equal(normalizeLectureAccessCode(code), code.replaceAll('-', ''));
  }
  assert.equal(normalizeLectureAccessCode('wrong-code'), null);
  const normalized = normalizeLectureAccessCode(codes[0]);
  assert.ok(normalized);
  assert.equal(await hashLectureAccessCode(normalized), await hashLectureAccessCode(normalized));
  assert.notEqual(await hashLectureAccessCode(normalized), normalized);

  const source = await readFile(new URL('../app/lib/lecture-access-codes.ts', import.meta.url), 'utf8');
  assert.match(source, /randomBytes\(CODE_GROUPS \* CODE_GROUP_LENGTH\)/);
  assert.doesNotMatch(source, /Math\.random/);
});

test('50 concurrent attempts produce exactly one owner and one persistent grant', async () => {
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const code = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(code);
  assert.ok(normalized);
  const database = new AtomicCodeDatabase(await hashLectureAccessCode(normalized));
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      redeemLectureAccessCode(database, `student-${index}@example.test`, code)
    )
  );
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
  const generationRoute = await readFile(
    new URL('../app/api/admin/videos/[id]/access-codes/route.ts', import.meta.url),
    'utf8'
  );
  const redemptionRoute = await readFile(
    new URL('../app/api/lecture-access-codes/redeem/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(generationRoute, /apiStaff\(request, 'manage_videos'\)/);
  assert.match(generationRoute, /SELECT id, course_id AS courseId FROM videos WHERE id = \?/);
  assert.match(generationRoute, /requireSameOrigin\(request\)/);
  assert.match(redemptionRoute, /apiVerifiedUser\(\)/);
  assert.match(redemptionRoute, /lecture-code-account/);
  assert.match(redemptionRoute, /lecture-code-ip/);
  assert.match(redemptionRoute, /requireSameOrigin\(request\)/);
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
