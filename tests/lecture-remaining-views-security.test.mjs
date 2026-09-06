import assert from 'node:assert/strict';
import test from 'node:test';

class MockViewSessionDatabase {
  videos = new Map();
  enrollments = new Map();
  viewSessions = [];
  studentSessions = new Map();
  studentUsers = new Map();
  grants = new Set();
  enrollmentRows = new Map();

  constructor() {
    this.videos.set('video-limited-3', {
      id: 'video-limited-3',
      courseId: 'course-1',
      title: 'محاضرة قواعد محددة المشاهدات',
      durationSeconds: 1800,
      maxViews: 3,
      status: 'published',
      createdAt: 1000,
    });

    this.videos.set('video-unlimited', {
      id: 'video-unlimited',
      courseId: 'course-1',
      title: 'محاضرة غير محدودة المشاهدات',
      durationSeconds: 2400,
      maxViews: 0,
      status: 'published',
      createdAt: 2000,
    });

    this.enrollments.set('student@test.com:course-1', {
      userEmail: 'student@test.com',
      courseId: 'course-1',
      status: 'approved',
    });

    const tokenHash = 'student-token-hash-123';
    this.studentSessions.set(tokenHash, {
      tokenHash,
      userEmail: 'student@test.com',
      expiresAt: Date.now() + 86400000,
    });

    this.studentUsers.set('student@test.com', {
      email: 'student@test.com',
      name: 'طالب تجريبي',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });
  }

  prepare(sql) {
    const db = this;
    return {
      bindings: [],
      bind(...args) {
        this.bindings = args;
        return this;
      },
      async first() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // User session lookup
        if (s.includes('FROM native_sessions s JOIN users u')) {
          const [tokenHash] = this.bindings;
          const session = db.studentSessions.get(tokenHash);
          if (!session || session.expiresAt <= Date.now()) return null;
          const user = db.studentUsers.get(session.userEmail);
          if (!user || user.status !== 'active') return null;
          return {
            email: user.email,
            name: user.name,
            emailVerified: user.isVerified,
          };
        }

        // Video lookup for view-session/start
        if (s.includes('SELECT id, course_id AS courseId, max_views AS maxViews FROM videos WHERE id = ?')) {
          const [id] = this.bindings;
          const v = db.videos.get(id);
          return v ? { id: v.id, courseId: v.courseId, maxViews: v.maxViews } : null;
        }

        // Enrollment check
        if (s.includes('FROM enrollments WHERE user_email = ? AND course_id = ? AND status = \'approved\'')) {
          const [email, courseId] = this.bindings;
          const en = db.enrollments.get(`${email}:${courseId}`);
          return en ? { 1: 1 } : null;
        }

        // Grant check
        if (s.includes('FROM student_video_access_grants WHERE video_id = ? AND student_email = ?')) {
          const [videoId, email] = this.bindings;
          const hasGrant = db.grants.has(`${email}:${videoId}`);
          return hasGrant ? { 1: 1 } : null;
        }

        // Existing active session check
        if (s.includes('SELECT id, expires_at AS expiresAt FROM video_view_sessions') && s.includes("status = 'active'")) {
          const [videoId, email] = this.bindings;
          const match = db.viewSessions.find(
            (vs) => vs.videoId === videoId && vs.userEmail === email && vs.status === 'active'
          );
          return match ? { id: match.id, expiresAt: match.expiresAt } : null;
        }

        // View count check: SELECT COUNT(*) AS count FROM video_view_sessions
        if (s.includes('SELECT COUNT(*) AS count FROM video_view_sessions')) {
          const [videoId, email] = this.bindings;
          const count = db.viewSessions.filter(
            (vs) =>
              vs.videoId === videoId &&
              vs.userEmail === email &&
              ['active', 'expired', 'submitted'].includes(vs.status)
          ).length;
          return { count };
        }

        // Enrollment by ID lookup
        if (s.includes('SELECT user_email AS userEmail, course_id AS courseId, status FROM enrollments WHERE id = ?')) {
          const [id] = this.bindings;
          return db.enrollmentRows.get(id) || null;
        }

        return null;
      },
      async all() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Batch query in LearnPage
        if (s.includes('SELECT s.video_id AS videoId, COUNT(*) AS count FROM video_view_sessions s')) {
          const [email, courseId] = this.bindings;
          const counts = new Map();
          for (const vs of db.viewSessions) {
            const v = db.videos.get(vs.videoId);
            if (
              vs.userEmail === email &&
              v &&
              v.courseId === courseId &&
              ['active', 'expired', 'submitted'].includes(vs.status)
            ) {
              counts.set(vs.videoId, (counts.get(vs.videoId) || 0) + 1);
            }
          }
          const results = [];
          for (const [videoId, count] of counts.entries()) {
            results.push({ videoId, count });
          }
          return { results };
        }

        return { results: [] };
      },
      async run() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // UPDATE enrollments
        if (s.includes('UPDATE enrollments SET status = ?')) {
          const [status, now, id] = this.bindings;
          const en = db.enrollmentRows.get(id);
          if (en) {
            en.status = status;
            en.updatedAt = now;
          }
          return { success: true, meta: { changes: 1 } };
        }

        // DELETE FROM video_view_sessions
        if (s.includes('DELETE FROM video_view_sessions')) {
          const [userEmail, courseId] = this.bindings;
          const initialLen = db.viewSessions.length;
          db.viewSessions = db.viewSessions.filter((vs) => {
            const v = db.videos.get(vs.videoId);
            const matchesUser = vs.userEmail === userEmail;
            const matchesCourse = courseId ? (v && v.courseId === courseId) : true;
            return !(matchesUser && matchesCourse);
          });
          const changes = initialLen - db.viewSessions.length;
          return { success: true, meta: { changes } };
        }

        // INSERT INTO video_view_sessions
        if (s.includes('INSERT INTO video_view_sessions')) {
          const [id, videoId, userEmail, sessionToken, startedAt, lastActiveAt, expiresAt, createdAt] =
            this.bindings;
          db.viewSessions.push({
            id,
            videoId,
            userEmail,
            sessionToken,
            startedAt,
            lastActiveAt,
            expiresAt,
            createdAt,
            status: 'active',
          });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
    };
  }
}

// Helpers for remaining views calculation and formatting
function setupDb(db) {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
    VIDEO_RESOLVE_SECRET: 'test-video-resolve-secret-32-chars-long!',
    INITIAL_STAFF_EMAIL: 'teacher@example.test',
  };
}

function calculateRemainingViews(maxViews, usedViews) {
  return maxViews > 0 ? Math.max(maxViews - usedViews, 0) : null;
}

function formatRemainingViewsText(maxViews, remainingViews) {
  if (maxViews === 0 || remainingViews === null || remainingViews === undefined) {
    return 'مشاهدة غير محدودة';
  }
  if (remainingViews === 0) {
    return 'تم استخدام جميع مرات المشاهدة';
  }
  if (remainingViews === 1) {
    return 'متبقي لك مشاهدة واحدة';
  }
  return `متبقي لك ${remainingViews} من ${maxViews} مشاهدات`;
}

test('Step 5 & 6: Configure test lecture max_views = 3, new student sees 3/3 remaining', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const video = db.videos.get('video-limited-3');
  assert.equal(video.maxViews, 3);

  // Read-only query simulation for new student
  const usedViews = db.viewSessions.filter(
    (vs) =>
      vs.videoId === video.id &&
      vs.userEmail === 'student@test.com' &&
      ['active', 'expired', 'submitted'].includes(vs.status)
  ).length;

  assert.equal(usedViews, 0, 'New student has 0 used views');
  const remaining = calculateRemainingViews(video.maxViews, usedViews);
  assert.equal(remaining, 3, 'Remaining views is 3');

  const text = formatRemainingViewsText(video.maxViews, remaining);
  assert.equal(text, 'متبقي لك 3 من 3 مشاهدات');
  assert.equal(db.viewSessions.length, 0, 'Querying remaining views is strictly read-only');
});

test('Step 7 & 8: Start first legitimate view session -> student sees 2/3 remaining', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');

  // Request with student cookie
  const cookieHeader = 'session=mock-token;';
  // We mock crypto hash in session lookup to match student-token-hash-123
  const origCrypto = globalThis.crypto;
  const req = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'session=some-student-token;',
    },
    body: '{}',
  });

  // Since route uses apiVerifiedUser() which checks sha256 of session cookie, let's inject a valid cookie
  const crypto = await import('node:crypto');
  const rawToken = 'test-student-session-secret';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'student@test.com',
    expiresAt: Date.now() + 86400000,
  });

  const authedReq = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });

  const res = await POST(authedReq, { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.sessionId, 'Session ID returned');
  assert.equal(data.viewsRemaining, 2, 'API returns viewsRemaining = 2');

  // Verify DB state
  assert.equal(db.viewSessions.length, 1, 'Exactly 1 session consumed');
  const usedViews = db.viewSessions.length;
  const remaining = calculateRemainingViews(3, usedViews);
  assert.equal(remaining, 2);
  assert.equal(formatRemainingViewsText(3, remaining), 'متبقي لك 2 من 3 مشاهدات');
});

test('Step 9: Page reload / active session reuse does NOT decrease remaining count', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const crypto = await import('node:crypto');
  const rawToken = 'test-student-session-secret-reload';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'student@test.com',
    expiresAt: Date.now() + 86400000,
  });

  // First view session
  const req1 = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });
  const res1 = await POST(req1, { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res1.status, 200);
  assert.equal(db.viewSessions.length, 1);

  // Student reloads page — frontend queries view counts (read-only)
  const usedViewsAfterReload = db.viewSessions.filter(
    (vs) => vs.videoId === 'video-limited-3' && vs.userEmail === 'student@test.com'
  ).length;
  assert.equal(usedViewsAfterReload, 1, 'Still 1 used view after page reload');
  assert.equal(calculateRemainingViews(3, usedViewsAfterReload), 2, 'Still 2 remaining');

  // Player starts viewing again while session is active:
  const req2 = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });
  const res2 = await POST(req2, { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.viewsRemaining, null, 'Active session returns null viewsRemaining (reused, not newly consumed)');
  assert.equal(db.viewSessions.length, 1, 'Session count did NOT increase on reload/reconnect');
});

test('Step 10 & 11: Consume views until 0, then backend blocks additional viewing with 403', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const crypto = await import('node:crypto');
  const rawToken = 'test-student-session-secret-exhaust';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'student@test.com',
    expiresAt: Date.now() + 86400000,
  });

  const createStartReq = () =>
    new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        cookie: `englizeka_student=${rawToken};`,
      },
      body: '{}',
    });

  // View 1
  const res1 = await POST(createStartReq(), { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.viewsRemaining, 2);

  // Expire session 1
  db.viewSessions[0].status = 'expired';

  // View 2
  const res2 = await POST(createStartReq(), { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.viewsRemaining, 1);
  assert.equal(formatRemainingViewsText(3, 1), 'متبقي لك مشاهدة واحدة');

  // Expire session 2
  db.viewSessions[1].status = 'expired';

  // View 3
  const res3 = await POST(createStartReq(), { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res3.status, 200);
  const data3 = await res3.json();
  assert.equal(data3.viewsRemaining, 0);
  assert.equal(formatRemainingViewsText(3, 0), 'تم استخدام جميع مرات المشاهدة');

  // Expire session 3
  db.viewSessions[2].status = 'expired';

  // Attempt View 4 -> MUST BE BLOCKED WITH 403
  const res4 = await POST(createStartReq(), { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res4.status, 403);
  const data4 = await res4.json();
  assert.equal(data4.error, 'لقد استنفدت عدد المشاهدات المسموحة لهذه المحاضرة');

  // Total sessions remain capped at 3
  assert.equal(db.viewSessions.length, 3);
  assert.equal(calculateRemainingViews(3, db.viewSessions.length), 0);
});

test('Unlimited video (max_views = 0) returns null remaining and never blocks', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const crypto = await import('node:crypto');
  const rawToken = 'test-student-session-unlimited';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'student@test.com',
    expiresAt: Date.now() + 86400000,
  });

  const remaining = calculateRemainingViews(0, 50);
  assert.equal(remaining, null);
  assert.equal(formatRemainingViewsText(0, remaining), 'مشاهدة غير محدودة');

  const req = new Request('http://localhost:3000/api/student/videos/video-unlimited/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'video-unlimited' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.viewsRemaining, null);
});

test('Security: Unenrolled student cannot start viewing session', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const crypto = await import('node:crypto');
  const rawToken = 'test-unenrolled-token';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'stranger@test.com',
    expiresAt: Date.now() + 86400000,
  });
  db.studentUsers.set('stranger@test.com', {
    email: 'stranger@test.com',
    name: 'طالب غير مسجل',
    role: 'student',
    status: 'active',
    isVerified: 1,
  });

  const req = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'غير مصرح بالدخول');
});

test('Student with individual video access grant can start viewing session without full course enrollment', async () => {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  const crypto = await import('node:crypto');
  const rawToken = 'grant-student-token-456';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'grant-student@test.com',
    expiresAt: Date.now() + 86400000,
  });

  db.studentUsers.set('grant-student@test.com', {
    email: 'grant-student@test.com',
    name: 'طالب كود QR',
    role: 'student',
    status: 'active',
    isVerified: 1,
  });

  // Not enrolled in course-1, but has individual grant for video-limited-3
  db.grants.add('grant-student@test.com:video-limited-3');

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/video-limited-3/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: `englizeka_student=${rawToken};`,
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'video-limited-3' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.sessionId);
  assert.equal(data.viewsRemaining, 2);
});

// ============================================================================
// PER-LECTURE SCOPING & COURSE RENEWAL RESET TESTS
// ============================================================================

function setupMultiLectureMultiCourseEnv() {
  const db = new MockViewSessionDatabase();
  setupDb(db);

  // Course 1
  db.videos.set('video-1a', {
    id: 'video-1a',
    courseId: 'course-1',
    title: 'محاضرة 1 أ',
    maxViews: 5,
    status: 'published',
  });
  db.videos.set('video-1b', {
    id: 'video-1b',
    courseId: 'course-1',
    title: 'محاضرة 1 ب',
    maxViews: 5,
    status: 'published',
  });
  db.videos.set('video-1c', {
    id: 'video-1c',
    courseId: 'course-1',
    title: 'محاضرة 1 ج',
    maxViews: 5,
    status: 'published',
  });

  // Course 2
  db.videos.set('video-2a', {
    id: 'video-2a',
    courseId: 'course-2',
    title: 'محاضرة 2 أ',
    maxViews: 4,
    status: 'published',
  });

  // Enrollments
  db.enrollments.set('student1@test.com:course-1', { userEmail: 'student1@test.com', courseId: 'course-1', status: 'approved' });
  db.enrollments.set('student1@test.com:course-2', { userEmail: 'student1@test.com', courseId: 'course-2', status: 'approved' });
  db.enrollments.set('student2@test.com:course-1', { userEmail: 'student2@test.com', courseId: 'course-1', status: 'approved' });

  db.enrollmentRows.set('enr-s1-c1', { id: 'enr-s1-c1', userEmail: 'student1@test.com', courseId: 'course-1', status: 'approved' });
  db.enrollmentRows.set('enr-s1-c2', { id: 'enr-s1-c2', userEmail: 'student1@test.com', courseId: 'course-2', status: 'approved' });
  db.enrollmentRows.set('enr-s2-c1', { id: 'enr-s2-c1', userEmail: 'student2@test.com', courseId: 'course-1', status: 'approved' });

  // Users & Sessions
  for (const email of ['student1@test.com', 'student2@test.com']) {
    db.studentUsers.set(email, { email, name: email, role: 'student', status: 'active', isVerified: 1 });
  }

  return db;
}

test('1. Lecture A usage does not affect Lecture B', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  // Student 1 watches Lecture A 3 times
  for (let i = 0; i < 3; i++) {
    db.viewSessions.push({
      id: `s-1a-${i}`,
      videoId: 'video-1a',
      userEmail: 'student1@test.com',
      status: 'expired',
      expiresAt: Date.now() - 1000,
    });
  }

  // Check counts
  const usedA = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  const usedB = db.viewSessions.filter((vs) => vs.videoId === 'video-1b' && vs.userEmail === 'student1@test.com').length;
  assert.equal(usedA, 3);
  assert.equal(usedB, 0, 'Lecture B usage remains 0 when Lecture A is watched');

  const remA = calculateRemainingViews(5, usedA);
  const remB = calculateRemainingViews(5, usedB);
  assert.equal(remA, 2);
  assert.equal(remB, 5, 'Lecture B has all 5 views remaining');
});

test('2. Lecture B usage does not affect Lecture A', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  // Student 1 watches Lecture A 2 times
  for (let i = 0; i < 2; i++) {
    db.viewSessions.push({ id: `s-1a-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }
  // Student 1 watches Lecture B 4 times
  for (let i = 0; i < 4; i++) {
    db.viewSessions.push({ id: `s-1b-${i}`, videoId: 'video-1b', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }

  const usedA = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  const usedB = db.viewSessions.filter((vs) => vs.videoId === 'video-1b' && vs.userEmail === 'student1@test.com').length;
  assert.equal(usedA, 2, 'Lecture A still has 2 used views');
  assert.equal(usedB, 4, 'Lecture B has 4 used views');
  assert.equal(calculateRemainingViews(5, usedA), 3);
  assert.equal(calculateRemainingViews(5, usedB), 1);
});

test('3. Student 1 usage does not affect Student 2', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  // Student 1 exhausts Lecture A (5 views)
  for (let i = 0; i < 5; i++) {
    db.viewSessions.push({ id: `s-s1-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }

  const usedS1 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  const usedS2 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student2@test.com').length;
  assert.equal(usedS1, 5);
  assert.equal(usedS2, 0, 'Student 2 has not used any views on Lecture A');
  assert.equal(calculateRemainingViews(5, usedS1), 0);
  assert.equal(calculateRemainingViews(5, usedS2), 5);
});

test('4. Course 1 usage does not affect Course 2', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  // Student 1 uses views in Course 1
  for (let i = 0; i < 3; i++) {
    db.viewSessions.push({ id: `s-c1-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }

  const usedC1 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  const usedC2 = db.viewSessions.filter((vs) => vs.videoId === 'video-2a' && vs.userEmail === 'student1@test.com').length;
  assert.equal(usedC1, 3);
  assert.equal(usedC2, 0, 'Course 2 video has 0 used views');
  assert.equal(calculateRemainingViews(4, usedC2), 4);
});

test('5. Reactivating Course 1 resets ALL lecture view counts for that student in Course 1', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');

  // Before renewal:
  // Lecture A: 5 used (0 remaining)
  for (let i = 0; i < 5; i++) {
    db.viewSessions.push({ id: `s-1a-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }
  // Lecture B: 3 used (2 remaining)
  for (let i = 0; i < 3; i++) {
    db.viewSessions.push({ id: `s-1b-${i}`, videoId: 'video-1b', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }
  // Lecture C: 1 used (4 remaining)
  db.viewSessions.push({ id: 's-1c-0', videoId: 'video-1c', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });

  // Reactivate Course 1 for Student 1
  const result = await resetCourseLectureViewAllowance('student1@test.com', 'course-1');
  assert.equal(result.changes, 9, 'Reset 9 view session records in Course 1');

  // After renewal: all lectures in Course 1 have 5 of 5 remaining
  for (const vid of ['video-1a', 'video-1b', 'video-1c']) {
    const used = db.viewSessions.filter((vs) => vs.videoId === vid && vs.userEmail === 'student1@test.com').length;
    assert.equal(used, 0, `${vid} has 0 used views after renewal`);
    assert.equal(calculateRemainingViews(5, used), 5, `${vid} has 5 of 5 remaining`);
    assert.equal(formatRemainingViewsText(5, 5), 'متبقي لك 5 من 5 مشاهدات');
  }
});

test('6. Reactivating Course 1 does NOT reset Course 2', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');

  // Student 1 uses 2 views in Course 2
  for (let i = 0; i < 2; i++) {
    db.viewSessions.push({ id: `s-2a-${i}`, videoId: 'video-2a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }
  // Student 1 uses 3 views in Course 1
  for (let i = 0; i < 3; i++) {
    db.viewSessions.push({ id: `s-1a-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }

  // Reactivate Course 1 only
  await resetCourseLectureViewAllowance('student1@test.com', 'course-1');

  // Course 1 is reset
  const usedC1 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  assert.equal(usedC1, 0, 'Course 1 views reset to 0');

  // Course 2 is NOT reset
  const usedC2 = db.viewSessions.filter((vs) => vs.videoId === 'video-2a' && vs.userEmail === 'student1@test.com').length;
  assert.equal(usedC2, 2, 'Course 2 view count remains 2 (not reset)');
  assert.equal(calculateRemainingViews(4, usedC2), 2, 'Course 2 still has 2 of 4 remaining');
});

test('7. Reactivating Student 1 does NOT reset Student 2', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');

  // Student 1 uses 4 views in Course 1
  for (let i = 0; i < 4; i++) {
    db.viewSessions.push({ id: `s-s1-${i}`, videoId: 'video-1a', userEmail: 'student1@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }
  // Student 2 uses 3 views in Course 1
  for (let i = 0; i < 3; i++) {
    db.viewSessions.push({ id: `s-s2-${i}`, videoId: 'video-1a', userEmail: 'student2@test.com', status: 'expired', expiresAt: Date.now() - 1000 });
  }

  // Reactivate Course 1 for Student 1 only
  await resetCourseLectureViewAllowance('student1@test.com', 'course-1');

  const usedS1 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com').length;
  const usedS2 = db.viewSessions.filter((vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student2@test.com').length;

  assert.equal(usedS1, 0, 'Student 1 views reset to 0');
  assert.equal(usedS2, 3, 'Student 2 views remain 3 (unaffected by Student 1 reset)');
  assert.equal(calculateRemainingViews(5, usedS2), 2, 'Student 2 still has 2 remaining');
});

test('8. Old active playback sessions for that course are invalidated/reset', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');

  // Student 1 has an active playback session in Course 1
  db.viewSessions.push({
    id: 'active-sess-1',
    videoId: 'video-1a',
    userEmail: 'student1@test.com',
    sessionToken: 'tok-active-1',
    status: 'active',
    expiresAt: Date.now() + 1800000,
    startedAt: Date.now() - 1000,
    lastActiveAt: Date.now(),
  });

  // Reactivate Course 1
  await resetCourseLectureViewAllowance('student1@test.com', 'course-1');

  // Verify active session was removed/invalidated
  const activeSess = db.viewSessions.find(
    (vs) => vs.videoId === 'video-1a' && vs.userEmail === 'student1@test.com' && vs.status === 'active'
  );
  assert.equal(activeSess, undefined, 'Old active playback session has been removed on course reactivation');
});

test('9. max_views values configured by teacher remain unchanged', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');

  const origMaxViews1A = db.videos.get('video-1a').maxViews;
  const origMaxViews1B = db.videos.get('video-1b').maxViews;
  const origMaxViews2A = db.videos.get('video-2a').maxViews;

  await resetCourseLectureViewAllowance('student1@test.com', 'course-1');

  assert.equal(db.videos.get('video-1a').maxViews, origMaxViews1A, 'video-1a maxViews untouched');
  assert.equal(db.videos.get('video-1b').maxViews, origMaxViews1B, 'video-1b maxViews untouched');
  assert.equal(db.videos.get('video-2a').maxViews, origMaxViews2A, 'video-2a maxViews untouched');
});

test('10. After reset the student can start a new playback session again', async () => {
  const db = setupMultiLectureMultiCourseEnv();
  const { resetCourseLectureViewAllowance } = await import('../app/lib/video-access.ts');
  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');

  const crypto = await import('node:crypto');
  const rawToken = 'student1-fresh-token';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  db.studentSessions.set(tokenHash, {
    tokenHash,
    userEmail: 'student1@test.com',
    expiresAt: Date.now() + 86400000,
  });

  // Before reset: exhaust all 5 views
  for (let i = 0; i < 5; i++) {
    db.viewSessions.push({
      id: `s-1a-exhaust-${i}`,
      videoId: 'video-1a',
      userEmail: 'student1@test.com',
      status: 'expired',
      expiresAt: Date.now() - 1000,
    });
  }

  const makeReq = () =>
    new Request('http://localhost:3000/api/student/videos/video-1a/view-session/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        cookie: `englizeka_student=${rawToken};`,
      },
      body: '{}',
    });

  // Attempt before reset -> blocked with 403
  const resBefore = await POST(makeReq(), { params: Promise.resolve({ id: 'video-1a' }) });
  assert.equal(resBefore.status, 403, 'Exhausted student blocked with 403 before reset');

  // Reactivate / Renew Course 1
  await resetCourseLectureViewAllowance('student1@test.com', 'course-1');

  // Attempt after reset -> succeeds with 200 and viewsRemaining = 4 (out of 5)
  const resAfter = await POST(makeReq(), { params: Promise.resolve({ id: 'video-1a' }) });
  assert.equal(resAfter.status, 200, 'Student can start playback session after reset');
  const dataAfter = await resAfter.json();
  assert.ok(dataAfter.sessionId, 'Fresh session ID returned');
  assert.equal(dataAfter.viewsRemaining, 4, 'viewsRemaining is 4 (5 - 1)');
});
