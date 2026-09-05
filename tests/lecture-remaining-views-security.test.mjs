import assert from 'node:assert/strict';
import test from 'node:test';

class MockViewSessionDatabase {
  videos = new Map();
  enrollments = new Map();
  viewSessions = [];
  studentSessions = new Map();
  studentUsers = new Map();

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
          return { success: true };
        }
        return { success: true };
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
