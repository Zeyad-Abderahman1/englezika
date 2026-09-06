import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';

class MockFullPlatformDatabase {
  videos = new Map();
  materials = [];
  enrollments = new Map();
  viewSessions = [];
  studentSessions = new Map();
  studentUsers = new Map();
  grants = new Set();
  exams = new Map();
  examSessions = new Map();
  attempts = new Map();
  violations = [];
  questions = new Map();

  constructor() {
    this.videos.set('vid-limited', {
      id: 'vid-limited',
      courseId: 'course-1',
      sourceType: 'youtube',
      youtubeId: 'dQw4w9WgXcQ',
      durationSeconds: 1200,
      title: 'محاضرة محددة المشاهدات',
      status: 'published',
      maxViews: 2,
      createdAt: 1000,
      prerequisiteExamId: null,
      minimumScore: 0,
    });

    this.enrollments.set('student@test.com:course-1', {
      userEmail: 'student@test.com',
      courseId: 'course-1',
      status: 'approved',
    });

    this.materials.push({
      id: 'mat-1',
      videoId: 'vid-limited',
      storageKey: 'private/materials/secret-key-123.pdf',
      fileName: 'ملخص المحاضرة الأولى',
      fileSize: 2048000,
    });

    this.exams.set('exam-1', {
      id: 'exam-1',
      courseId: 'course-1',
      title: 'امتحان تجريبي',
      description: 'وصف الامتحان',
      instructions: 'تعليمات الامتحان',
      durationMinutes: 30,
      passingScore: 50,
      maxAttempts: 2,
      status: 'published',
    });

    this.questions.set('exam-1', [
      {
        id: 'q-1',
        examId: 'exam-1',
        points: 5,
        correctAnswer: 'A',
        type: 'multiple_choice',
      },
      {
        id: 'q-2',
        examId: 'exam-1',
        points: 5,
        correctAnswer: 'B',
        type: 'multiple_choice',
      },
    ]);

    // Setup student 1 (token >= 16 chars)
    const token1 = 'token-student-1-test-long';
    const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
    this.studentSessions.set(hash1, {
      tokenHash: hash1,
      userEmail: 'student@test.com',
      expiresAt: Date.now() + 86400000,
    });
    this.studentUsers.set('student@test.com', {
      email: 'student@test.com',
      name: 'طالب مسجل',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });

    // Setup student 2 (QR granted only, token >= 16 chars)
    const token2 = 'token-qr-student-test-long';
    const hash2 = crypto.createHash('sha256').update(token2).digest('hex');
    this.studentSessions.set(hash2, {
      tokenHash: hash2,
      userEmail: 'qr@test.com',
      expiresAt: Date.now() + 86400000,
    });
    this.studentUsers.set('qr@test.com', {
      email: 'qr@test.com',
      name: 'طالب كود QR',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });
    this.grants.add('qr@test.com:vid-limited');

    // Setup student 3 (unauthorized, token >= 16 chars)
    const token3 = 'token-unauth-student-long';
    const hash3 = crypto.createHash('sha256').update(token3).digest('hex');
    this.studentSessions.set(hash3, {
      tokenHash: hash3,
      userEmail: 'unauth@test.com',
      expiresAt: Date.now() + 86400000,
    });
    this.studentUsers.set('unauth@test.com', {
      email: 'unauth@test.com',
      name: 'طالب غير مسجل',
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

        // Native session lookup
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

        // Authorize video access
        if (s.includes('FROM videos v WHERE v.id = ? AND v.status = \'published\' LIMIT 1')) {
          const [normEmail1, normEmail2, videoId] = this.bindings;
          const v = db.videos.get(videoId);
          if (!v) return null;
          const hasEnrollmentAccess = db.enrollments.has(`${normEmail1}:${v.courseId}`) ? 1 : 0;
          const hasIndividualGrant = db.grants.has(`${normEmail2}:${v.id}`) ? 1 : 0;
          return {
            id: v.id,
            courseId: v.courseId,
            sourceType: v.sourceType,
            sourceUrl: `https://www.youtube.com/watch?v=${v.youtubeId}`,
            youtubeId: v.youtubeId,
            durationSeconds: v.durationSeconds,
            title: v.title,
            prerequisiteExamId: v.prerequisiteExamId,
            minimumScore: v.minimumScore,
            maxViews: v.maxViews,
            hasEnrollmentAccess,
            hasIndividualGrant,
          };
        }

        // Single video lookup
        if (s.includes('FROM videos WHERE id = ?')) {
          const [id] = this.bindings;
          const v = db.videos.get(id);
          return v ? { id: v.id, courseId: v.courseId, maxViews: v.maxViews } : null;
        }

        // Enrollment check
        if (s.includes('FROM enrollments WHERE user_email = ? AND course_id = ? AND status = \'approved\'')) {
          const [email, courseId] = this.bindings;
          return db.enrollments.has(`${email}:${courseId}`) ? { 1: 1 } : null;
        }

        // Grant check
        if (s.includes('FROM student_video_access_grants WHERE video_id = ? AND student_email = ?')) {
          const [videoId, email] = this.bindings;
          return db.grants.has(`${email}:${videoId}`) ? { 1: 1 } : null;
        }

        // Active video session check
        if (s.includes('FROM video_view_sessions') && s.includes("status = 'active'")) {
          const [videoId, email] = this.bindings;
          const match = db.viewSessions.find(
            (vs) => vs.videoId === videoId && vs.userEmail === email && vs.status === 'active'
          );
          return match ? { id: match.id, expiresAt: match.expiresAt } : null;
        }

        // Count video view sessions
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

        // Exam lookup
        if (s.includes('FROM exams x LEFT JOIN enrollments e')) {
          const [email, examId] = this.bindings;
          const ex = db.exams.get(examId);
          if (!ex) return null;
          return {
            id: ex.id,
            courseId: ex.courseId,
            title: ex.title,
            description: ex.description,
            instructions: ex.instructions,
            durationMinutes: ex.durationMinutes,
            passingScore: ex.passingScore,
            maxAttempts: ex.maxAttempts,
            opensAt: null,
            closesAt: null,
            assessmentType: 'exam',
            mode: 'online',
          };
        }

        // Course sequence items check
        if (s.includes('FROM course_sequence_items WHERE course_id = ?')) {
          return null;
        }

        // Exam session lookup
        if (s.includes('FROM exam_sessions') && s.includes('WHERE id = ?')) {
          const [id] = this.bindings;
          return db.examSessions.get(id) || null;
        }

        if (s.includes('FROM exam_sessions') && s.includes('WHERE exam_id = ? AND user_email = ?')) {
          const [examId, email] = this.bindings;
          for (const s of db.examSessions.values()) {
            if (s.examId === examId && s.userEmail === email) {
              return s;
            }
          }
          return null;
        }

        // Attempt count
        if (s.includes('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')) {
          const [examId, email] = this.bindings;
          let count = 0;
          for (const a of db.attempts.values()) {
            if (a.examId === examId && a.userEmail === email) count++;
          }
          return { count };
        }

        // Exam focus violation stats
        if (s.includes('SELECT COUNT(*) AS count, MAX(created_at) AS lastViolationAt FROM exam_focus_violations')) {
          const [attemptId, email] = this.bindings;
          const matching = db.violations.filter(
            (v) => v.attemptId === attemptId && v.userEmail === email
          );
          const count = matching.length;
          const lastViolationAt = count > 0 ? Math.max(...matching.map((v) => v.createdAt)) : null;
          return { count, lastViolationAt };
        }

        // Attempt lookup by ID
        if (s.includes('FROM attempts WHERE id = ?')) {
          const [id] = this.bindings;
          return db.attempts.get(id) || null;
        }

        // Rate limit handling
        if (s.includes('INSERT INTO rate_limits')) {
          return { count: 1, resetAt: Date.now() + 60000 };
        }

        return null;
      },
      async all() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Lecture materials
        if (s.includes('FROM lecture_materials WHERE video_id = ?')) {
          const [videoId] = this.bindings;
          const results = db.materials.filter((m) => m.videoId === videoId);
          return { results, success: true, meta: { changes: results.length } };
        }

        // Questions for exam
        if (s.includes('FROM questions WHERE exam_id = ?')) {
          const [examId] = this.bindings;
          const results = db.questions.get(examId) || [];
          return { results, success: true, meta: { changes: results.length } };
        }

        return { results: [], success: true, meta: { changes: 0 } };
      },
      async run() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Rate limit handling
        if (s.includes('rate_limits')) {
          return { success: true, meta: { changes: 1 } };
        }

        // Insert video view session
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

        // Insert violation
        if (s.includes('INSERT INTO exam_focus_violations')) {
          const [id, attemptId, examId, userEmail, ...rest] = this.bindings;
          const createdAt = rest.length === 2 ? rest[1] : rest[0];
          const violationNumber = rest.length === 2 ? rest[0] : 1;
          db.violations.push({
            id,
            attemptId,
            examId,
            userEmail,
            violationNumber,
            createdAt,
          });
          return { success: true, meta: { changes: 1 } };
        }

        // Update exam session
        if (s.includes("UPDATE exam_sessions SET status = 'terminated'")) {
          const [id] = this.bindings;
          const session = db.examSessions.get(id);
          if (session) {
            session.status = 'terminated';
          }
          return { success: true, meta: { changes: 1 } };
        }

        // Insert attempt
        if (s.includes('INSERT INTO attempts')) {
          if (this.bindings.length === 8) {
            const [id, examId, userEmail, score, maxScore, feedback, startedAt, submittedAt] =
              this.bindings;
            db.attempts.set(id, {
              id,
              examId,
              userEmail,
              status: 'terminated',
              score,
              maxScore,
              feedback,
              gradingMethod: 'focus_violation',
              startedAt,
              submittedAt,
            });
          } else {
            const [id, examId, userEmail, status, score, maxScore, feedback, gradingMethod, startedAt, submittedAt] =
              this.bindings;
            db.attempts.set(id, {
              id,
              examId,
              userEmail,
              status,
              score,
              maxScore,
              feedback,
              gradingMethod,
              startedAt,
              submittedAt,
            });
          }
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      },
    };
  }
}

function setupTestEnv(db) {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
    VIDEO_RESOLVE_SECRET: 'test-video-resolve-secret-32-chars-long!',
    INITIAL_STAFF_EMAIL: 'teacher@example.test',
  };
}

// ============================================================================
// 1. VIDEO TESTS
// ============================================================================

test('Video: Zero remaining views + no active session denies /resolve with 403 VIEW_LIMIT_REACHED', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  // Exhaust all 2 allowed views
  const now = Date.now();
  db.viewSessions.push({
    id: 's-1',
    videoId: 'vid-limited',
    userEmail: 'student@test.com',
    status: 'expired',
    expiresAt: now - 10000,
  });
  db.viewSessions.push({
    id: 's-2',
    videoId: 'vid-limited',
    userEmail: 'student@test.com',
    status: 'expired',
    expiresAt: now - 5000,
  });

  const { GET } = await import('../app/api/videos/[id]/resolve/route.ts');
  const req = new Request('http://localhost:3000/api/videos/vid-limited/resolve', {
    headers: {
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
  });

  const res = await GET(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'VIEW_LIMIT_REACHED');
  assert.equal(data.error, 'لقد استنفدت عدد المشاهدات المسموحة لهذه المحاضرة');
  assert.equal(data.youtubeId, undefined);
  assert.equal(data.videoSource, undefined);
});

test('Video: Active valid session allows /resolve even if total views reached limit', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const now = Date.now();
  // 1 expired, 1 active valid session
  db.viewSessions.push({
    id: 's-1',
    videoId: 'vid-limited',
    userEmail: 'student@test.com',
    status: 'expired',
    expiresAt: now - 10000,
  });
  db.viewSessions.push({
    id: 's-2',
    videoId: 'vid-limited',
    userEmail: 'student@test.com',
    status: 'active',
    expiresAt: now + 600000, // 10 minutes left
  });

  const { GET } = await import('../app/api/videos/[id]/resolve/route.ts');
  const req = new Request('http://localhost:3000/api/videos/vid-limited/resolve', {
    headers: {
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
  });

  const res = await GET(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(data.activeSession.sessionId, 's-2');
  assert.ok(data.activeSession.expiresAt > now);
});

test('Video: view-session/start returns VIEW_LIMIT_REACHED when count >= maxViews', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const now = Date.now();
  db.viewSessions.push(
    { id: 's-1', videoId: 'vid-limited', userEmail: 'student@test.com', status: 'expired', expiresAt: now - 1000 },
    { id: 's-2', videoId: 'vid-limited', userEmail: 'student@test.com', status: 'expired', expiresAt: now - 500 }
  );

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/vid-limited/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'VIEW_LIMIT_REACHED');
});

test('Video: refresh/re-render reuses active session and does NOT consume another view', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const now = Date.now();
  db.viewSessions.push({
    id: 's-active',
    videoId: 'vid-limited',
    userEmail: 'student@test.com',
    status: 'active',
    expiresAt: now + 900000,
  });

  const initialCount = db.viewSessions.length;

  const { POST } = await import('../app/api/student/videos/[id]/view-session/start/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/vid-limited/view-session/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sessionId, 's-active');
  assert.equal(data.viewsRemaining, null);
  assert.equal(db.viewSessions.length, initialCount, 'No new session was inserted');
});

// ============================================================================
// 2. MATERIALS TESTS
// ============================================================================

test('Materials: Enrolled authorized student gets materials without private storage keys exposed', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const { GET } = await import('../app/api/student/videos/[id]/materials/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/vid-limited/materials', {
    headers: {
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
  });

  const res = await GET(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.materials));
  assert.equal(data.materials.length, 1);
  assert.equal(data.materials[0].fileName, 'ملخص المحاضرة الأولى');
  assert.equal(data.materials[0].storageKey, undefined, 'Private storage key must never be exposed');
});

test('Materials: QR-granted student gets materials for granted video without course enrollment', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const { GET } = await import('../app/api/student/videos/[id]/materials/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/vid-limited/materials', {
    headers: {
      cookie: 'englizeka_student=token-qr-student-test-long;',
    },
  });

  const res = await GET(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.materials.length, 1);
  assert.equal(data.materials[0].fileName, 'ملخص المحاضرة الأولى');
});

test('Materials: Unauthorized student cannot access materials', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  const { GET } = await import('../app/api/student/videos/[id]/materials/route.ts');
  const req = new Request('http://localhost:3000/api/student/videos/vid-limited/materials', {
    headers: {
      cookie: 'englizeka_student=token-unauth-student-long;',
    },
  });

  const res = await GET(req, { params: Promise.resolve({ id: 'vid-limited' }) });
  assert.equal(res.status, 403);
});

// ============================================================================
// 3. EXAM FOCUS PROTECTION TESTS
// ============================================================================

test('Exam: First visibility leave records violation 1 and does NOT terminate', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  // Active exam session
  db.examSessions.set('sess-exam-1', {
    id: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    startedAt: Date.now() - 10000,
    expiresAt: Date.now() + 1800000,
    status: 'active',
  });

  const { POST } = await import('../app/api/attempts/[id]/focus-violation/route.ts');
  const req = new Request('http://localhost:3000/api/attempts/sess-exam-1/focus-violation', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
    body: JSON.stringify({ answers: { 'q-1': 'A' } }),
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'sess-exam-1' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.violationCount, 1);
  assert.equal(data.terminated, false);

  const session = db.examSessions.get('sess-exam-1');
  assert.equal(session.status, 'active', 'Session remains active after first violation');
});

test('Exam: Duplicate leave event within 3 seconds does not double-count', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  db.examSessions.set('sess-exam-1', {
    id: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    startedAt: Date.now() - 10000,
    expiresAt: Date.now() + 1800000,
    status: 'active',
  });

  const { POST } = await import('../app/api/attempts/[id]/focus-violation/route.ts');
  const makeReq = () =>
    new Request('http://localhost:3000/api/attempts/sess-exam-1/focus-violation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        cookie: 'englizeka_student=token-student-1-test-long;',
      },
      body: JSON.stringify({ answers: { 'q-1': 'A' } }),
    });

  // First leave
  const res1 = await POST(makeReq(), { params: Promise.resolve({ id: 'sess-exam-1' }) });
  const data1 = await res1.json();
  assert.equal(data1.violationCount, 1);

  // Duplicate leave event (e.g. visibilitychange + pagehide firing within 100ms)
  const res2 = await POST(makeReq(), { params: Promise.resolve({ id: 'sess-exam-1' }) });
  const data2 = await res2.json();
  assert.equal(data2.violationCount, 1, 'Duplicate event must not increment violation count');
  assert.equal(data2.terminated, false);
});

test('Exam: Second distinct leave terminates attempt and marks session terminated', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  db.examSessions.set('sess-exam-1', {
    id: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    startedAt: Date.now() - 10000,
    expiresAt: Date.now() + 1800000,
    status: 'active',
  });

  // Prior violation older than 5 seconds
  db.violations.push({
    id: 'v-1',
    attemptId: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    violationNumber: 1,
    createdAt: Date.now() - 5000,
  });

  const { POST } = await import('../app/api/attempts/[id]/focus-violation/route.ts');
  const req = new Request('http://localhost:3000/api/attempts/sess-exam-1/focus-violation', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
    body: JSON.stringify({ answers: { 'q-1': 'A' } }),
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'sess-exam-1' }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.violationCount, 2);
  assert.equal(data.terminated, true);

  const session = db.examSessions.get('sess-exam-1');
  assert.equal(session.status, 'terminated', 'Session must be marked terminated on second violation');

  // Verify attempt was inserted with status = terminated
  let foundTerminatedAttempt = false;
  for (const a of db.attempts.values()) {
    if (a.examId === 'exam-1' && a.userEmail === 'student@test.com' && a.status === 'terminated') {
      foundTerminatedAttempt = true;
      assert.equal(a.gradingMethod, 'focus_violation');
      assert.equal(a.score, 5, 'Available correct answer scored before termination');
    }
  }
  assert.ok(foundTerminatedAttempt, 'Attempt row must be persisted with status terminated');
});

test('Exam: Terminated attempt rejects further submissions and restart via refresh', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  db.examSessions.set('sess-exam-1', {
    id: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    startedAt: Date.now() - 10000,
    expiresAt: Date.now() + 1800000,
    status: 'terminated',
  });

  const { GET: getExam } = await import('../app/api/exams/[id]/route.ts');
  const req = new Request('http://localhost:3000/api/exams/exam-1', {
    headers: { cookie: 'englizeka_student=token-student-1-test-long;' },
  });

  const getRes = await getExam(req, { params: Promise.resolve({ id: 'exam-1' }) });
  assert.equal(getRes.status, 403);
  const getData = await getRes.json();
  assert.equal(getData.terminated, true);

  const { POST: startExam } = await import('../app/api/exams/[id]/start/route.ts');
  const startReq = new Request('http://localhost:3000/api/exams/exam-1/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '2',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-student-1-test-long;',
    },
    body: '{}',
  });
  const startRes = await startExam(startReq, { params: Promise.resolve({ id: 'exam-1' }) });
  assert.equal(startRes.status, 403);
  const startData = await startRes.json();
  assert.equal(startData.terminated, true);
});

test('Exam: Another student cannot report violation on someone elses attempt', async () => {
  const db = new MockFullPlatformDatabase();
  setupTestEnv(db);

  db.examSessions.set('sess-exam-1', {
    id: 'sess-exam-1',
    examId: 'exam-1',
    userEmail: 'student@test.com',
    startedAt: Date.now() - 10000,
    expiresAt: Date.now() + 1800000,
    status: 'active',
  });

  const { POST } = await import('../app/api/attempts/[id]/focus-violation/route.ts');
  const req = new Request('http://localhost:3000/api/attempts/sess-exam-1/focus-violation', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=token-unauth-student-long;', // Different student
    },
    body: '{}',
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'sess-exam-1' }) });
  assert.equal(res.status, 403);
});

test('Hygiene & Code Inspection: Vidstack CSP domains in next.config.ts', async () => {
  const configSource = await readFile('next.config.ts', 'utf8');
  assert.match(configSource, /https:\/\/www\.youtube\.com/);
  assert.match(configSource, /https:\/\/s\.ytimg\.com/);
  assert.match(configSource, /https:\/\/i\.ytimg\.com/);
  assert.match(configSource, /https:\/\/\*\.ggpht\.com/);
  assert.match(configSource, /https:\/\/\*\.googlevideo\.com/);
  assert.match(configSource, /https:\/\/www\.youtube-nocookie\.com/);
});
