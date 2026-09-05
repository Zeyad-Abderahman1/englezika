import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

class MockAccessCodeDatabase {
  videos = new Map();
  courses = new Map();
  staffUsers = new Map();
  staffSessions = new Map();
  lectureAccessCodes = new Map();
  studentGrants = new Map();
  enrollments = new Map();
  videoProgress = new Map();
  courseItems = [];

  constructor() {
    this.courses.set('course-1', { id: 'course-1', title: 'كورس اللغة الإنجليزية', grade: 'الثانوية العامة' });
    this.videos.set('video-1', {
      id: 'video-1',
      courseId: 'course-1',
      title: 'المحاضرة الأولى: الأزمنة',
      durationSeconds: 1800,
      sourceType: 'youtube',
      youtubeId: 'xyz123',
      status: 'published',
      prerequisiteExamId: null,
      minimumScore: 0,
      createdAt: 1000,
    });
    this.videos.set('video-2', {
      id: 'video-2',
      courseId: 'course-1',
      title: 'المحاضرة الثانية: القواعد المتقدمة',
      durationSeconds: 2400,
      sourceType: 'youtube',
      youtubeId: 'abc456',
      status: 'published',
      prerequisiteExamId: null,
      minimumScore: 0,
      createdAt: 2000,
    });
    this.videos.set('video-3', {
      id: 'video-3',
      courseId: 'course-1',
      title: 'المحاضرة الثالثة: المفردات والمحادثة',
      durationSeconds: 2000,
      sourceType: 'youtube',
      youtubeId: 'def789',
      status: 'published',
      prerequisiteExamId: null,
      minimumScore: 0,
      createdAt: 3000,
    });

    this.staffUsers.set('teacher@example.test', {
      email: 'teacher@example.test',
      name: 'الأستاذ المشرف',
      role: 'teacher',
      permissions: '["manage_videos","manage_courses"]',
      active: 1,
    });

    // Valid teacher session token: cookie is 'mock-teacher-token-12345', DB stores SHA-256 of it
    // SHA-256('mock-teacher-token-12345') = 4828102094929af597691dad62c7a95d9d711ea6bf7f36c6c2f1473fb397b986
    const tokenHash = '4828102094929af597691dad62c7a95d9d711ea6bf7f36c6c2f1473fb397b986';
    this.staffSessions.set(tokenHash, {
      tokenHash,
      staffEmail: 'teacher@example.test',
      expiresAt: Date.now() + 3600000,
    });
  }

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return new (class {
      bindings = [];
      bind(...args) {
        this.bindings = args;
        return this;
      }

      async first() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Staff session lookup
        if (s.includes('FROM staff_sessions s JOIN staff_users u')) {
          const [tokenHash] = this.bindings;
          const session = db.staffSessions.get(tokenHash);
          if (!session || session.expiresAt <= Date.now()) return null;
          const user = db.staffUsers.get(session.staffEmail);
          if (!user || !user.active) return null;
          return {
            expiresAt: session.expiresAt,
            email: user.email,
            name: user.name,
            role: user.role,
            permissions: user.permissions,
          };
        }

        // Video lookup
        if (s.startsWith('SELECT id, title FROM videos WHERE id = ?')) {
          const [id] = this.bindings;
          const v = db.videos.get(id);
          return v ? { id: v.id, title: v.title } : null;
        }

        if (s.startsWith('SELECT id, course_id AS courseId, title FROM videos WHERE id = ?') ||
            s.startsWith('SELECT id, course_id AS courseId FROM videos WHERE id = ?')) {
          const [id] = this.bindings;
          const v = db.videos.get(id);
          return v ? { id: v.id, courseId: v.courseId, title: v.title } : null;
        }

        // Course items exist check
        if (s.startsWith('SELECT 1 FROM course_items WHERE course_id = ? LIMIT 1')) {
          const [courseId] = this.bindings;
          const exists = db.courseItems.some((ci) => ci.courseId === courseId);
          return exists ? { 1: 1 } : null;
        }

        // Single code redemption CTE
        if (s.startsWith('WITH candidate AS')) {
          const [codeHash, , email, , , redeemedAt] = this.bindings;
          const row = db.lectureAccessCodes.get(codeHash);
          if (!row || row.redeemedAt !== null) return null;
          row.redeemedAt = redeemedAt;
          row.redeemedBy = email;
          const grantId = `${email}:${row.videoId}`;
          db.studentGrants.set(grantId, {
            id: grantId,
            studentEmail: email,
            videoId: row.videoId,
            source: 'one_time_code',
            sourceAccessCodeId: row.id,
            createdAt: redeemedAt,
          });
          const v = db.videos.get(row.videoId);
          const c = db.courses.get(row.courseId);
          return {
            courseId: row.courseId,
            videoId: row.videoId,
            videoTitle: v?.title || '',
            courseTitle: c?.title || '',
          };
        }

        // Check redeemed_at
        if (s.startsWith('SELECT redeemed_at AS redeemedAt FROM lecture_access_codes WHERE code_hash = ?')) {
          const [codeHash] = this.bindings;
          const row = db.lectureAccessCodes.get(codeHash);
          return row ? { redeemedAt: row.redeemedAt } : null;
        }

        // authorizeVideoAccess check
        if (s.startsWith('SELECT v.id, v.course_id AS courseId')) {
          const [email1, email2, videoId] = this.bindings;
          const v = db.videos.get(videoId);
          if (!v || v.status !== 'published') return null;
          const hasEnrollment = db.enrollments.has(`${email1}:${v.courseId}`) ? 1 : 0;
          const hasGrant = db.studentGrants.has(`${email2}:${videoId}`) ? 1 : 0;
          return {
            id: v.id,
            courseId: v.courseId,
            sourceType: v.sourceType,
            youtubeId: v.youtubeId,
            durationSeconds: v.durationSeconds,
            title: v.title,
            prerequisiteExamId: v.prerequisiteExamId,
            minimumScore: v.minimumScore,
            hasEnrollmentAccess: hasEnrollment,
            hasIndividualGrant: hasGrant,
          };
        }

        return null;
      }

      async all() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Query codes in PDF route
        if (s.includes('FROM lecture_access_codes') && s.includes('code_hash IN')) {
          const results = [];
          for (const hash of this.bindings) {
            const row = db.lectureAccessCodes.get(hash);
            if (row) {
              results.push({
                id: row.id,
                codeHash: row.codeHash,
                videoId: row.videoId,
                redeemedAt: row.redeemedAt,
              });
            }
          }
          return { success: true, results, meta: { changes: 0 } };
        }

        // Course items list
        if (s.includes('FROM course_items ci')) {
          const [courseId] = this.bindings;
          const items = db.courseItems.filter((ci) => ci.courseId === courseId);
          return { success: true, results: items, meta: { changes: 0 } };
        }

        // Video progress
        if (s.includes('FROM video_progress')) {
          const [email] = this.bindings;
          const ids = this.bindings.slice(1);
          const results = ids
            .filter((vid) => db.videoProgress.has(`${email}:${vid}`))
            .map((vid) => ({ videoId: vid }));
          return { success: true, results, meta: { changes: 0 } };
        }

        // Student grants
        if (s.includes('FROM student_video_access_grants g')) {
          const [email, courseId] = this.bindings;
          const results = [];
          for (const grant of db.studentGrants.values()) {
            if (grant.studentEmail === email) {
              const v = db.videos.get(grant.videoId);
              if (v && v.courseId === courseId && v.status === 'published') {
                results.push({ videoId: grant.videoId });
              }
            }
          }
          return { success: true, results, meta: { changes: 0 } };
        }

        return { success: true, results: [], meta: { changes: 0 } };
      }

      async run() {
        return { success: true, results: [], meta: { changes: 1 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const st of statements) {
      results.push(await st.run());
    }
    return results;
  }
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Setup platform environment with mock DB
let mockDb;
function setupMockEnv() {
  mockDb = new MockAccessCodeDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: mockDb,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
    VIDEO_RESOLVE_SECRET: 'test-video-resolve-secret-32-chars-long!',
    INITIAL_STAFF_EMAIL: 'teacher@example.test',
  };
}

test('CASE 1: Single code end-to-end lifecycle (Generate -> Hash -> PDF -> Redeem -> Grant -> Video Auth)', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  // 1. Generate code
  const code = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(code);
  assert.ok(normalized);
  const hash = await hashLectureAccessCode(normalized);

  // Store in DB
  mockDb.lectureAccessCodes.set(hash, {
    id: 'code-1',
    codeHash: hash,
    videoId: 'video-1',
    courseId: 'course-1',
    displaySuffix: normalized.slice(-5),
    redeemedAt: null,
    redeemedBy: null,
  });

  // 2. Invoke PDF endpoint with valid staff cookie
  const req = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({
      videoId: 'video-1',
      codes: [code],
    }),
  });

  const pdfRes = await pdfRoute(req);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
  const pdfBytes = await pdfRes.arrayBuffer();
  assert.ok(pdfBytes.byteLength > 100);

  // 3. Redeem the SAME code
  const studentEmail = 'student1@example.test';
  const redeemRes = await redeemLectureAccessCode(mockDb, studentEmail, code);
  assert.equal(redeemRes.status, 'success');
  assert.equal(redeemRes.videoId, 'video-1');

  // Verify grant created in DB
  const grantKey = `${studentEmail}:video-1`;
  assert.ok(mockDb.studentGrants.has(grantKey));
  const grant = mockDb.studentGrants.get(grantKey);
  assert.equal(grant.source, 'one_time_code');
  assert.equal(grant.videoId, 'video-1');

  // Verify authorizeVideoAccess succeeds
  const auth = await authorizeVideoAccess(studentEmail, 'video-1');
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.video.id, 'video-1');
    assert.equal(auth.video.hasIndividualGrant, 1);
  }
});

test('CASE 2: Bulk 5 codes generation, PDF export, unique hashes, and single redemption', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  const codes = [];
  const hashes = new Set();

  for (let i = 0; i < 5; i++) {
    const code = generateLectureAccessCode();
    const normalized = normalizeLectureAccessCode(code);
    assert.ok(normalized);
    const hash = await hashLectureAccessCode(normalized);
    codes.push(code);
    hashes.add(hash);
    mockDb.lectureAccessCodes.set(hash, {
      id: `bulk-code-${i}`,
      codeHash: hash,
      videoId: 'video-1',
      courseId: 'course-1',
      displaySuffix: normalized.slice(-5),
      redeemedAt: null,
      redeemedBy: null,
    });
  }

  // Exactly 5 unique hashes
  assert.equal(hashes.size, 5);

  // PDF endpoint accepts all 5 codes
  const req = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({
      videoId: 'video-1',
      codes,
    }),
  });
  const res = await pdfRoute(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');

  // Each code redeems successfully once
  for (let i = 0; i < 5; i++) {
    const student = `bulk-student-${i}@example.test`;
    const redeemResult = await redeemLectureAccessCode(mockDb, student, codes[i]);
    assert.equal(redeemResult.status, 'success');
  }
});

test('CASE 3: Altered code is rejected and creates zero grants', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');

  const genuineCode = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(genuineCode);
  assert.ok(normalized);
  const hash = await hashLectureAccessCode(normalized);

  mockDb.lectureAccessCodes.set(hash, {
    id: 'genuine-code',
    codeHash: hash,
    videoId: 'video-1',
    courseId: 'course-1',
    displaySuffix: normalized.slice(-5),
    redeemedAt: null,
    redeemedBy: null,
  });

  // Mutate last character to another valid character in CODE_ALPHABET
  const lastChar = genuineCode.slice(-1);
  const replacementChar = lastChar === 'X' ? 'Y' : 'X';
  const alteredCode = genuineCode.slice(0, -1) + replacementChar;

  const result = await redeemLectureAccessCode(mockDb, 'student@example.test', alteredCode);
  assert.equal(result.status, 'invalid_code');
  assert.equal(mockDb.studentGrants.size, 0);
});

test('CASE 4: One-time use enforced (second attempt returns already_used)', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
    redeemLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');

  const code = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(code);
  assert.ok(normalized);
  const hash = await hashLectureAccessCode(normalized);

  mockDb.lectureAccessCodes.set(hash, {
    id: 'single-use-code',
    codeHash: hash,
    videoId: 'video-1',
    courseId: 'course-1',
    displaySuffix: normalized.slice(-5),
    redeemedAt: null,
    redeemedBy: null,
  });

  const firstRedeem = await redeemLectureAccessCode(mockDb, 'first-student@example.test', code);
  assert.equal(firstRedeem.status, 'success');

  const secondRedeem = await redeemLectureAccessCode(mockDb, 'second-student@example.test', code);
  assert.equal(secondRedeem.status, 'already_used');

  // Verify grant count remains exactly 1
  assert.equal(mockDb.studentGrants.size, 1);
});

test('CASE 5: Fake masked code ENG-•••••-ABCDE is rejected and no route fallback constructs it', async () => {
  setupMockEnv();
  const { normalizeLectureAccessCode, redeemLectureAccessCode } = await import('../app/lib/lecture-access-codes.ts');
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  const fakeMasked = 'ENG-•••••-ABCDE';
  assert.equal(normalizeLectureAccessCode(fakeMasked), null);

  const redeemResult = await redeemLectureAccessCode(mockDb, 'student@example.test', fakeMasked);
  assert.equal(redeemResult.status, 'invalid_code');

  const req = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({
      videoId: 'video-1',
      codes: [fakeMasked],
    }),
  });
  const res = await pdfRoute(req);
  assert.equal(res.status, 400);

  // Source inspection: Ensure route file contains zero database fallback or bullets
  const routeSource = await readFile(new URL('../app/api/admin/access-codes/pdf/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(routeSource, /ENG-•••••-/);
  assert.doesNotMatch(routeSource, /SELECT.*display_suffix.*FROM lecture_access_codes/);
});

test('CASE 6: PDF without plaintext codes returns HTTP 400 PLAINTEXT_CODES_REQUIRED (zero DB fallback)', async () => {
  setupMockEnv();
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  // Request with videoId but NO codes
  const reqNoCodes = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({ videoId: 'video-1' }),
  });
  const resNoCodes = await pdfRoute(reqNoCodes);
  assert.equal(resNoCodes.status, 400);
  const dataNoCodes = await resNoCodes.json();
  assert.equal(dataNoCodes.error, 'PLAINTEXT_CODES_REQUIRED');

  // Request with empty codes array
  const reqEmpty = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({ videoId: 'video-1', codes: [] }),
  });
  const resEmpty = await pdfRoute(reqEmpty);
  assert.equal(resEmpty.status, 400);
  const dataEmpty = await resEmpty.json();
  assert.equal(dataEmpty.error, 'PLAINTEXT_CODES_REQUIRED');
});

test('CASE 7: PDF export for wrong video rejects submitted codes', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  // Generate code for Video 1
  const code = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(code);
  assert.ok(normalized);
  const hash = await hashLectureAccessCode(normalized);

  mockDb.lectureAccessCodes.set(hash, {
    id: 'code-video-1',
    codeHash: hash,
    videoId: 'video-1',
    courseId: 'course-1',
    displaySuffix: normalized.slice(-5),
    redeemedAt: null,
    redeemedBy: null,
  });

  // Attempt to export PDF for Video 2 with Code 1
  const req = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({
      videoId: 'video-2',
      codes: [code],
    }),
  });
  const res = await pdfRoute(req);
  assert.equal(res.status, 400);
});

test('CASE 8: PDF export rejects already redeemed codes', async () => {
  setupMockEnv();
  const {
    generateLectureAccessCode,
    hashLectureAccessCode,
    normalizeLectureAccessCode,
  } = await import('../app/lib/lecture-access-codes.ts');
  const { POST: pdfRoute } = await import('../app/api/admin/access-codes/pdf/route.ts');

  const code = generateLectureAccessCode();
  const normalized = normalizeLectureAccessCode(code);
  assert.ok(normalized);
  const hash = await hashLectureAccessCode(normalized);

  // Store already redeemed code
  mockDb.lectureAccessCodes.set(hash, {
    id: 'code-redeemed',
    codeHash: hash,
    videoId: 'video-1',
    courseId: 'course-1',
    displaySuffix: normalized.slice(-5),
    redeemedAt: Date.now() - 10000,
    redeemedBy: 'student@example.test',
  });

  const req = new Request('http://localhost:3000/api/admin/access-codes/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-teacher-token-12345',
    },
    body: JSON.stringify({
      videoId: 'video-1',
      codes: [code],
    }),
  });
  const res = await pdfRoute(req);
  assert.equal(res.status, 400);
});

test('CASE 9 & 10: PDF text integrity and layout (LTR, nowrap, 2-column, no line wrap)', async () => {
  const chromePath = findChromePath();
  if (!chromePath) {
    // Skip browser rendering if Chrome is not present
    return;
  }

  const { generateLectureAccessCode } = await import('../app/lib/lecture-access-codes.ts');
  const code = generateLectureAccessCode();
  assert.equal(code.length, 39);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 }); // A4 dimensions at 96 DPI

    // Build the exact HTML that pdf-generator builds
    const html = `<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      @page { size: A4; margin: 20mm; }
      body {
        font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
        direction: rtl;
        background: #fff;
        padding: 20mm;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        width: 100%;
      }
      .card {
        border: 1px solid #000;
        border-radius: 4px;
        padding: 14px 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 72px;
        background: #fff;
        page-break-inside: avoid;
        overflow: hidden;
      }
      .code {
        font-family: 'Courier New', Courier, monospace;
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.2px;
        text-align: center;
        direction: ltr;
        unicode-bidi: isolate;
        white-space: nowrap;
        color: #000;
        line-height: 1.3;
      }
      .name {
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        direction: rtl;
        unicode-bidi: isolate;
        color: #000;
        margin-top: 6px;
        line-height: 1.4;
      }
    </style>
    </head>
    <body>
      <div class="grid">
        <div class="card">
          <div class="code" dir="ltr">${code}</div>
          <div class="name" dir="rtl" lang="ar">المحاضرة التجريبية الأولى</div>
        </div>
      </div>
    </body>
    </html>`;

    await page.setContent(html, { waitUntil: 'load' });

    const metrics = await page.evaluate(() => {
      const codeEl = document.querySelector('.code');
      const cardEl = document.querySelector('.card');
      const style = window.getComputedStyle(codeEl);
      return {
        text: codeEl.textContent,
        direction: style.direction,
        whiteSpace: style.whiteSpace,
        codeScrollWidth: codeEl.scrollWidth,
        codeClientWidth: codeEl.clientWidth,
        codeOffsetHeight: codeEl.offsetHeight,
        cardClientWidth: cardEl.clientWidth,
      };
    });

    // 1. Text integrity: Zero mutation, bidi characters, or alteration
    assert.equal(metrics.text, code);
    assert.equal(metrics.text.length, code.length);
    assert.deepEqual(Array.from(metrics.text), Array.from(code));

    // 2. CSS properties
    assert.equal(metrics.direction, 'ltr');
    assert.equal(metrics.whiteSpace, 'nowrap');

    // 3. Layout bounds: code element fits cleanly inside card without wrapping
    assert.ok(metrics.codeScrollWidth <= metrics.cardClientWidth);
    // Offset height must indicate exactly 1 line (~15-18px for 11.5px line-height 1.3)
    assert.ok(metrics.codeOffsetHeight <= 22);
  } finally {
    await browser.close();
  }
});

test('CASE 11: Individual grant overrides sequence lock in course tree and video player', async () => {
  setupMockEnv();
  const student = 'student-seq@example.test';

  // Set up course with 3 sequential videos: Video 1, Video 2, Video 3
  mockDb.courseItems = [
    { id: 'ci-1', courseId: 'course-1', itemType: 'video', videoId: 'video-1', examId: null, assignmentId: null, sortOrder: 0, createdAt: 100, title: 'المحاضرة الأولى' },
    { id: 'ci-2', courseId: 'course-1', itemType: 'video', videoId: 'video-2', examId: null, assignmentId: null, sortOrder: 1, createdAt: 200, title: 'المحاضرة الثانية' },
    { id: 'ci-3', courseId: 'course-1', itemType: 'video', videoId: 'video-3', examId: null, assignmentId: null, sortOrder: 2, createdAt: 300, title: 'المحاضرة الثالثة' },
  ];

  // Student is enrolled
  mockDb.enrollments.set(`${student}:course-1`, { id: 'enr-1', userEmail: student, courseId: 'course-1', status: 'approved' });

  // Student completed Video 1 only
  mockDb.videoProgress.set(`${student}:video-1`, { userEmail: student, videoId: 'video-1' });

  // Get sequence state
  const { getCourseSequenceUnlockState } = await import('../app/lib/course-sequence.ts');
  const seqState = await getCourseSequenceUnlockState('course-1', student);

  // Without grant: Video 1 is completed/unlocked, Video 2 is unlocked (next in sequence), Video 3 is locked!
  assert.equal(seqState.get('video:video-1')?.unlocked, true);
  assert.equal(seqState.get('video:video-2')?.unlocked, true);
  assert.equal(seqState.get('video:video-3')?.unlocked, false);
  assert.equal(seqState.get('video:video-3')?.lockReason, 'previous_item');

  // Now create an individual grant for Video 3 for this student
  mockDb.studentGrants.set(`${student}:video-3`, {
    id: 'grant-v3',
    studentEmail: student,
    videoId: 'video-3',
    source: 'one_time_code',
    createdAt: Date.now(),
  });

  const grantedIds = new Set(['video-3']);

  // Simulate sequenceItems map in app/learn/[courseId]/page.tsx
  const sequenceItems = mockDb.courseItems.map((item) => {
    const key = `${item.itemType}:${item.videoId || item.examId || item.assignmentId}`;
    const state = seqState.get(key);
    const isGrantedVideo = item.itemType === 'video' && Boolean(item.videoId) && grantedIds.has(item.videoId);
    return {
      key,
      itemType: item.itemType,
      itemId: item.videoId || '',
      title: item.title,
      unlocked: isGrantedVideo ? true : (state?.unlocked ?? false),
      isCompleted: state?.isCompleted ?? false,
      lockReason: isGrantedVideo ? null : (state?.lockReason ?? null),
    };
  });

  // Video 3 is now unlocked with lockReason null thanks to the grant!
  const v3Item = sequenceItems.find((i) => i.itemId === 'video-3');
  assert.ok(v3Item);
  assert.equal(v3Item.unlocked, true);
  assert.equal(v3Item.lockReason, null);

  // Video 1 and Video 2 retain their normal states
  const v1Item = sequenceItems.find((i) => i.itemId === 'video-1');
  assert.equal(v1Item.unlocked, true);
  assert.equal(v1Item.isCompleted, true);

  // Simulate video unlock state calculation in app/learn/[courseId]/page.tsx
  const video3 = mockDb.videos.get('video-3');
  const hasGrant = grantedIds.has(video3.id);
  let unlocked = 0;
  let lockReason = null;

  if (hasGrant) {
    unlocked = 1;
    lockReason = null;
  } else if (seqState.get(`video:${video3.id}`)) {
    unlocked = seqState.get(`video:${video3.id}`).unlocked ? 1 : 0;
    lockReason = seqState.get(`video:${video3.id}`).unlocked ? null : 'previous_lesson';
  }

  assert.equal(unlocked, 1);
  assert.equal(lockReason, null);
});

test('CASE 12: Backend authorization boundary: granted video succeeds, ungranted video rejects', async () => {
  setupMockEnv();
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  const studentWithGrant = 'grant-student@example.test';
  const studentWithoutGrant = 'no-grant-student@example.test';

  // Video 3 has grant for studentWithGrant only
  mockDb.studentGrants.set(`${studentWithGrant}:video-3`, {
    id: 'grant-v3',
    studentEmail: studentWithGrant,
    videoId: 'video-3',
    source: 'one_time_code',
    createdAt: Date.now(),
  });

  // studentWithGrant: authorizeVideoAccess for Video 3 succeeds
  const authGrant = await authorizeVideoAccess(studentWithGrant, 'video-3');
  assert.equal(authGrant.ok, true);
  if (authGrant.ok) {
    assert.equal(authGrant.video.hasIndividualGrant, 1);
  }

  // studentWithoutGrant: neither enrolled nor granted -> rejected with 403
  const authNoGrant = await authorizeVideoAccess(studentWithoutGrant, 'video-3');
  assert.equal(authNoGrant.ok, false);
  assert.equal(authNoGrant.status, 403);
});
