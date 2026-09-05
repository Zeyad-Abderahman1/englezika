import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLectureQRToken,
  hashLectureQRToken,
  normalizeLectureQRToken,
  buildLectureQRUrl,
  getLectureQRCodeInfo,
  redeemLectureAccessCode,
  hasLectureAccess,
} from '../app/lib/lecture-access-codes.ts';

// In-memory test database mocking SQLite/Postgres interface
function createTestDb() {
  const tables = {
    lecture_access_codes: [],
    student_video_access_grants: [],
    videos: [
      { id: 'vid-101', course_id: 'crs-1', title: 'Lecture 1: Grammar Mastery', description: 'Deep dive into English tenses' },
      { id: 'vid-102', course_id: 'crs-1', title: 'Lecture 2: Vocabulary Secrets', description: 'Advanced vocabulary building' },
    ],
    courses: [
      { id: 'crs-1', title: 'Third Secondary English 2026', stage: 'الصف الثالث الثانوي' },
    ],
    enrollments: [],
  };

  return {
    tables,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              // 1. getLectureQRCodeInfo lookup
              if (sql.includes('FROM lecture_access_codes lac') && sql.includes('WHERE lac.code_hash = ?')) {
                const [hash] = args;
                const codeRow = tables.lecture_access_codes.find((r) => r.code_hash === hash);
                if (!codeRow) return null;
                const video = tables.videos.find((v) => v.id === codeRow.video_id);
                const course = tables.courses.find((c) => c.id === codeRow.course_id);
                return {
                  courseId: course?.id,
                  courseTitle: course?.title,
                  videoId: video?.id,
                  videoTitle: video?.title,
                  redeemedAt: codeRow.redeemed_at,
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
  const urlDefault = buildLectureQRUrl(token, 'https://englizeka.com');
  assert.equal(urlDefault, 'https://englizeka.com/redeem#eqr_example_secure_token_12345');

  const urlTrailingSlash = buildLectureQRUrl(token, 'https://englizeka.com/');
  assert.equal(urlTrailingSlash, 'https://englizeka.com/redeem#eqr_example_secure_token_12345');

  const relativeUrl = buildLectureQRUrl(token, '');
  assert.equal(relativeUrl, '/redeem#eqr_example_secure_token_12345');
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

test('4. End-to-end QR code lifecycle: Generation -> Query Info -> Single-use Redemption -> Verify Access', async () => {
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

test('5. Non-existent QR tokens return invalid_token / invalid_code', async () => {
  const db = createTestDb();
  const fakeToken = generateLectureQRToken();

  const info = await getLectureQRCodeInfo(db, fakeToken);
  assert.equal(info.status, 'invalid_token');

  const redeem = await redeemLectureAccessCode(db, 'student@example.com', fakeToken);
  assert.equal(redeem.status, 'invalid_code');
});

test('6. QR redemption URL encodes token strictly into URL hash fragment and never query string', () => {
  const token = generateLectureQRToken();
  const fullUrl = buildLectureQRUrl(token, 'https://englezika.com');
  const parsed = new URL(fullUrl);

  assert.equal(parsed.pathname, '/redeem');
  assert.equal(parsed.search, '', 'Query string must be completely empty');
  assert.equal(parsed.hash, `#${token}`, 'Hash fragment must contain the exact token');
  assert.match(parsed.hash, /^#eqr_[A-Za-z0-9_-]{32}$/);
});

test('7. Student QR redemption endpoint route requires token and rejects code', async () => {
  const { readFile } = await import('node:fs/promises');
  const redeemRouteContent = await readFile(
    new URL('../app/api/student/qr/redeem/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(redeemRouteContent, /body\.token/);
  assert.doesNotMatch(redeemRouteContent, /body\.code/);
  assert.match(redeemRouteContent, /normalizeLectureQRToken\(body\.token\)/);
});

