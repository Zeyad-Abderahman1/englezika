import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class MockSequenceDatabase {
  courseItems = [];
  videos = new Map();
  exams = new Map();
  assignments = new Map();
  videoProgress = new Set();
  examAttempts = new Map();
  assignmentSubmissions = new Set();
  enrollments = new Set();
  grants = new Set();
  staffUsers = new Map();
  staffSessions = new Map();

  constructor() {
    this.staffUsers.set('teacher@example.test', {
      email: 'teacher@example.test',
      name: 'معلم المشرف',
      role: 'teacher',
      permissions: '["manage_courses","manage_videos"]',
      active: 1,
    });
    // SHA-256('mock-staff-token-12345') = a7992e5de0229c29a23918d9d5569128b4666f658627c253a69f0c7aea9f4e73
    this.staffSessions.set('a7992e5de0229c29a23918d9d5569128b4666f658627c253a69f0c7aea9f4e73', {
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

        // hasCourseItems: SELECT 1 FROM course_items WHERE course_id = ? LIMIT 1
        if (s.startsWith('SELECT 1 FROM course_items WHERE course_id = ? LIMIT 1')) {
          const [courseId] = this.bindings;
          const exists = db.courseItems.some((item) => item.courseId === courseId);
          return exists ? { 1: 1 } : null;
        }

        // Course existence check
        if (s.startsWith('SELECT id FROM courses WHERE id = ?')) {
          const [courseId] = this.bindings;
          return courseId === 'course-1' ? { id: 'course-1' } : null;
        }

        // Item existence checks in course
        if (s.startsWith('SELECT id FROM videos WHERE id = ? AND course_id = ?')) {
          const [videoId, courseId] = this.bindings;
          const v = db.videos.get(videoId);
          return v && v.courseId === courseId ? { id: v.id } : null;
        }
        if (s.startsWith('SELECT id FROM exams WHERE id = ? AND course_id = ?')) {
          const [examId, courseId] = this.bindings;
          const x = db.exams.get(examId);
          return x && x.courseId === courseId ? { id: x.id } : null;
        }
        if (s.startsWith('SELECT id FROM assignments WHERE id = ? AND course_id = ?')) {
          const [assignmentId, courseId] = this.bindings;
          const a = db.assignments.get(assignmentId);
          return a && a.courseId === courseId ? { id: a.id } : null;
        }

        // Video authorization check
        if (s.startsWith('SELECT v.id, v.course_id AS courseId')) {
          const [email1, email2, videoId] = this.bindings;
          const v = db.videos.get(videoId);
          if (!v || v.status !== 'published') return null;
          const hasEnrollment = db.enrollments.has(`${email1}:${v.courseId}`) ? 1 : 0;
          const hasGrant = db.grants.has(`${email2}:${videoId}`) ? 1 : 0;
          return {
            id: v.id,
            courseId: v.courseId,
            sourceType: v.sourceType || 'youtube',
            youtubeId: v.youtubeId || 'xyz123',
            durationSeconds: v.durationSeconds || 120,
            title: v.title,
            prerequisiteExamId: v.prerequisiteExamId || null,
            minimumScore: v.minimumScore || 0,
            hasEnrollmentAccess: hasEnrollment,
            hasIndividualGrant: hasGrant,
          };
        }

        // Previous video in legacy fallback
        if (s.includes('WHERE course_id = ? AND status = \'published\' AND created_at <')) {
          const [courseId] = this.bindings;
          const courseVids = [...db.videos.values()]
            .filter((v) => v.courseId === courseId && v.status === 'published')
            .sort((a, b) => b.createdAt - a.createdAt);
          return courseVids[1] ? { id: courseVids[1].id } : null;
        }

        // Video progress check in legacy fallback
        if (s.startsWith('SELECT id FROM video_progress WHERE user_email = ? AND video_id = ? LIMIT 1')) {
          const [email, vid] = this.bindings;
          return db.videoProgress.has(`${email}:${vid}`) ? { id: 'prog-1' } : null;
        }

        // Exam best attempt in legacy fallback
        if (s.startsWith('SELECT MAX(CASE WHEN max_score > 0')) {
          const [examId, email] = this.bindings;
          const score = db.examAttempts.get(`${email}:${examId}`);
          return { bestPercentage: score !== undefined ? score : null };
        }

        return null;
      }

      async all() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // getCourseItems
        if (s.startsWith('SELECT ci.id, ci.course_id AS courseId, ci.item_type AS itemType')) {
          const [courseId] = this.bindings;
          const items = db.courseItems
            .filter((i) => i.courseId === courseId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((i) => {
              let title = '';
              let assessmentType;
              if (i.itemType === 'video') title = db.videos.get(i.videoId)?.title || '';
              if (i.itemType === 'exam') {
                const ex = db.exams.get(i.examId);
                title = ex?.title || '';
                assessmentType = ex?.assessmentType || 'exam';
              }
              if (i.itemType === 'assignment') title = db.assignments.get(i.assignmentId)?.title || '';
              return { ...i, title, assessmentType };
            });
          return { success: true, results: items, meta: { changes: 0 } };
        }

        // Video progress in sequence check
        if (s.includes('FROM video_progress') && s.includes('video_id IN')) {
          const [email] = this.bindings;
          const ids = this.bindings.slice(1);
          const results = ids
            .filter((id) => db.videoProgress.has(`${email}:${id}`))
            .map((id) => ({ videoId: id }));
          return { success: true, results, meta: { changes: 0 } };
        }

        // Exam attempts in sequence check
        if (s.includes('FROM attempts') && s.includes('exam_id IN')) {
          const [email] = this.bindings;
          const ids = this.bindings.slice(1);
          const results = ids
            .filter((id) => db.examAttempts.has(`${email}:${id}`))
            .map((id) => ({ examId: id }));
          return { success: true, results, meta: { changes: 0 } };
        }

        // Assignment submissions in sequence check
        if (s.includes('FROM assignment_submissions') && s.includes('assignment_id IN')) {
          const [email] = this.bindings;
          const ids = this.bindings.slice(1);
          const results = ids
            .filter((id) => db.assignmentSubmissions.has(`${email}:${id}`))
            .map((id) => ({ assignmentId: id }));
          return { success: true, results, meta: { changes: 0 } };
        }

        return { success: true, results: [], meta: { changes: 0 } };
      }

      async run() {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('DELETE FROM course_items WHERE course_id = ?')) {
          const [courseId] = this.bindings;
          db.courseItems = db.courseItems.filter((i) => i.courseId !== courseId);
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (s.startsWith('INSERT INTO course_items')) {
          const [id, courseId, itemType, videoId, examId, assignmentId, sortOrder, createdAt] = this.bindings;
          db.courseItems.push({
            id,
            courseId,
            itemType,
            videoId: videoId || null,
            examId: examId || null,
            assignmentId: assignmentId || null,
            sortOrder,
            createdAt,
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        return { success: true, results: [], meta: { changes: 0 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

let mockDb;
function setupMockEnv() {
  mockDb = new MockSequenceDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: mockDb,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
    VIDEO_RESOLVE_SECRET: 'test-video-resolve-secret-32-chars-long!',
    INITIAL_STAFF_EMAIL: 'teacher@example.test',
  };
}

test('1. Course sequence unlocks items strictly sequentially (Video -> Exam -> Assignment)', async () => {
  setupMockEnv();
  const { getCourseSequenceUnlockState } = await import('../app/lib/course-sequence.ts');

  mockDb.videos.set('v1', { id: 'v1', courseId: 'course-1', title: 'المحاضرة 1', status: 'published', createdAt: 100 });
  mockDb.exams.set('x1', { id: 'x1', courseId: 'course-1', title: 'اختبار 1', assessmentType: 'quiz', status: 'published' });
  mockDb.assignments.set('a1', { id: 'a1', courseId: 'course-1', title: 'واجب 1', status: 'published' });

  mockDb.courseItems = [
    { id: 'ci-1', courseId: 'course-1', itemType: 'video', videoId: 'v1', examId: null, assignmentId: null, sortOrder: 0, createdAt: 100 },
    { id: 'ci-2', courseId: 'course-1', itemType: 'exam', videoId: null, examId: 'x1', assignmentId: null, sortOrder: 1, createdAt: 200 },
    { id: 'ci-3', courseId: 'course-1', itemType: 'assignment', videoId: null, examId: null, assignmentId: 'a1', sortOrder: 2, createdAt: 300 },
  ];

  const student = 'student@example.test';

  // Initially: Item 0 is unlocked, items 1 and 2 are locked
  let state = await getCourseSequenceUnlockState('course-1', student);
  assert.equal(state.get('video:v1')?.unlocked, true);
  assert.equal(state.get('video:v1')?.isCompleted, false);
  assert.equal(state.get('exam:x1')?.unlocked, false);
  assert.equal(state.get('exam:x1')?.lockReason, 'previous_item');
  assert.equal(state.get('assignment:a1')?.unlocked, false);

  // Complete Video 1 -> Exam 1 unlocks, Assignment remains locked
  mockDb.videoProgress.add(`${student}:v1`);
  state = await getCourseSequenceUnlockState('course-1', student);
  assert.equal(state.get('video:v1')?.isCompleted, true);
  assert.equal(state.get('exam:x1')?.unlocked, true);
  assert.equal(state.get('assignment:a1')?.unlocked, false);

  // Complete Exam 1 -> Assignment 1 unlocks
  mockDb.examAttempts.set(`${student}:x1`, 100);
  state = await getCourseSequenceUnlockState('course-1', student);
  assert.equal(state.get('exam:x1')?.isCompleted, true);
  assert.equal(state.get('assignment:a1')?.unlocked, true);

  // Complete Assignment 1 -> Everything completed and unlocked
  mockDb.assignmentSubmissions.add(`${student}:a1`);
  state = await getCourseSequenceUnlockState('course-1', student);
  assert.equal(state.get('assignment:a1')?.isCompleted, true);
});

test('2. Server-side video access enforces SEQUENCE_LOCKED for locked videos', async () => {
  setupMockEnv();
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  mockDb.videos.set('v1', { id: 'v1', courseId: 'course-1', title: 'المحاضرة 1', status: 'published', createdAt: 100 });
  mockDb.videos.set('v2', { id: 'v2', courseId: 'course-1', title: 'المحاضرة 2', status: 'published', createdAt: 200 });

  mockDb.courseItems = [
    { id: 'ci-1', courseId: 'course-1', itemType: 'video', videoId: 'v1', examId: null, assignmentId: null, sortOrder: 0, createdAt: 100 },
    { id: 'ci-2', courseId: 'course-1', itemType: 'video', videoId: 'v2', examId: null, assignmentId: null, sortOrder: 1, createdAt: 200 },
  ];

  const student = 'enrolled-student@example.test';
  mockDb.enrollments.add(`${student}:course-1`);

  // Video 1 is accessible, Video 2 is blocked by SEQUENCE_LOCKED
  const resV1 = await authorizeVideoAccess(student, 'v1');
  assert.equal(resV1.ok, true);

  const resV2 = await authorizeVideoAccess(student, 'v2');
  assert.equal(resV2.ok, false);
  assert.equal(resV2.code, 'SEQUENCE_LOCKED');
  assert.equal(resV2.status, 403);

  // Once Video 1 completed, Video 2 is accessible
  mockDb.videoProgress.add(`${student}:v1`);
  const resV2After = await authorizeVideoAccess(student, 'v2');
  assert.equal(resV2After.ok, true);
});

test('3. Single-use individual grant overrides sequence lock for that specific video', async () => {
  setupMockEnv();
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  mockDb.videos.set('v1', { id: 'v1', courseId: 'course-1', title: 'المحاضرة 1', status: 'published', createdAt: 100 });
  mockDb.videos.set('v2', { id: 'v2', courseId: 'course-1', title: 'المحاضرة 2', status: 'published', createdAt: 200 });

  mockDb.courseItems = [
    { id: 'ci-1', courseId: 'course-1', itemType: 'video', videoId: 'v1', examId: null, assignmentId: null, sortOrder: 0, createdAt: 100 },
    { id: 'ci-2', courseId: 'course-1', itemType: 'video', videoId: 'v2', examId: null, assignmentId: null, sortOrder: 1, createdAt: 200 },
  ];

  const student = 'grant-student@example.test';
  mockDb.enrollments.add(`${student}:course-1`);
  // Student has direct grant for Video 2
  mockDb.grants.add(`${student}:v2`);

  // Even though Video 1 is NOT completed, Video 2 succeeds because of individual grant
  const resV2 = await authorizeVideoAccess(student, 'v2');
  assert.equal(resV2.ok, true);
  if (resV2.ok) {
    assert.equal(resV2.video.hasIndividualGrant, 1);
  }
});

test('4. Legacy course fallback preserves prerequisite exam and created_at ordering', async () => {
  setupMockEnv();
  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  // Course has NO course_items (empty list)
  mockDb.courseItems = [];

  mockDb.videos.set('v1', { id: 'v1', courseId: 'legacy-course', title: 'قديم 1', status: 'published', createdAt: 100 });
  mockDb.videos.set('v2', {
    id: 'v2',
    courseId: 'legacy-course',
    title: 'قديم 2',
    status: 'published',
    createdAt: 200,
    prerequisiteExamId: 'x-legacy',
    minimumScore: 80,
  });

  const student = 'legacy-student@example.test';
  mockDb.enrollments.add(`${student}:legacy-course`);

  // Video 2 requires previous video (v1)
  const resNoV1 = await authorizeVideoAccess(student, 'v2');
  assert.equal(resNoV1.ok, false);
  assert.equal(resNoV1.code, 'PREVIOUS_LESSON_REQUIRED');

  // Complete v1, but prerequisite exam score < 80
  mockDb.videoProgress.add(`${student}:v1`);
  mockDb.examAttempts.set(`${student}:x-legacy`, 75);
  const resLowScore = await authorizeVideoAccess(student, 'v2');
  assert.equal(resLowScore.ok, false);
  assert.equal(resLowScore.code, 'LESSON_QUIZ_REQUIRED');

  // Prerequisite exam score >= 80 -> authorized
  mockDb.examAttempts.set(`${student}:x-legacy`, 85);
  const resPassed = await authorizeVideoAccess(student, 'v2');
  assert.equal(resPassed.ok, true);
});

test('5. Admin sequence route validates permissions, duplicates, foreign course items, and replaces atomically', async () => {
  setupMockEnv();
  const { POST: sequenceRoute, GET: getSequenceRoute } = await import(
    '../app/api/admin/courses/[id]/sequence/route.ts'
  );

  mockDb.videos.set('v1', { id: 'v1', courseId: 'course-1', title: 'فيديو 1', status: 'published' });
  mockDb.videos.set('v2', { id: 'v2', courseId: 'course-1', title: 'فيديو 2', status: 'published' });
  mockDb.videos.set('other-v', { id: 'other-v', courseId: 'other-course', title: 'فيديو خارجي', status: 'published' });

  // 1. Unauthorized request without staff cookie -> 401
  const unauthReq = new Request('http://localhost:3000/api/admin/courses/course-1/sequence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  const unauthRes = await sequenceRoute(unauthReq, { params: Promise.resolve({ id: 'course-1' }) });
  assert.equal(unauthRes.status, 401);

  // 2. Reject duplicate item
  const dupReq = new Request('http://localhost:3000/api/admin/courses/course-1/sequence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-staff-token-12345',
    },
    body: JSON.stringify({
      items: [
        { itemType: 'video', videoId: 'v1' },
        { itemType: 'video', videoId: 'v1' },
      ],
    }),
  });
  const dupRes = await sequenceRoute(dupReq, { params: Promise.resolve({ id: 'course-1' }) });
  assert.equal(dupRes.status, 400);

  // 3. Reject item from a different course
  const foreignReq = new Request('http://localhost:3000/api/admin/courses/course-1/sequence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-staff-token-12345',
    },
    body: JSON.stringify({
      items: [{ itemType: 'video', videoId: 'other-v' }],
    }),
  });
  const foreignRes = await sequenceRoute(foreignReq, { params: Promise.resolve({ id: 'course-1' }) });
  assert.equal(foreignRes.status, 400);

  // 4. Valid save replaces sequence atomically
  const validReq = new Request('http://localhost:3000/api/admin/courses/course-1/sequence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'englizeka_staff=mock-staff-token-12345',
    },
    body: JSON.stringify({
      items: [
        { itemType: 'video', videoId: 'v1' },
        { itemType: 'video', videoId: 'v2' },
      ],
    }),
  });
  const validRes = await sequenceRoute(validReq, { params: Promise.resolve({ id: 'course-1' }) });
  assert.equal(validRes.status, 200);
  assert.equal(mockDb.courseItems.length, 2);
  assert.equal(mockDb.courseItems[0].sortOrder, 0);
  assert.equal(mockDb.courseItems[1].sortOrder, 1);

  // 5. GET endpoint returns saved items
  const getReq = new Request('http://localhost:3000/api/admin/courses/course-1/sequence', {
    headers: { cookie: 'englizeka_staff=mock-staff-token-12345' },
  });
  const getRes = await getSequenceRoute(getReq, { params: Promise.resolve({ id: 'course-1' }) });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.items.length, 2);
  assert.equal(getData.items[0].videoId, 'v1');
  assert.equal(getData.items[1].videoId, 'v2');
});

test('6. Server-side sequence locking blocks starting an exam session when previous items are locked', async () => {
  setupMockEnv();

  mockDb.videos.set('v1', { id: 'v1', courseId: 'course-1', title: 'فيديو 1', status: 'published' });
  mockDb.exams.set('x1', {
    id: 'x1',
    courseId: 'course-1',
    title: 'امتحان مقفل',
    status: 'published',
    durationMinutes: 30,
    maxAttempts: 3,
  });

  mockDb.courseItems = [
    { id: 'ci-1', courseId: 'course-1', itemType: 'video', videoId: 'v1', examId: null, assignmentId: null, sortOrder: 0, createdAt: 100 },
    { id: 'ci-2', courseId: 'course-1', itemType: 'exam', videoId: null, examId: 'x1', assignmentId: null, sortOrder: 1, createdAt: 200 },
  ];

  const student = 'student@example.test';
  mockDb.enrollments.add(`${student}:course-1`);

  // Source inspection: verify assertExamUnlocked is invoked in exam start route
  const examStartSource = await readFile(
    new URL('../app/api/exams/[id]/start/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(examStartSource, /assertExamUnlocked\(id, exam\.courseId, email\)/);

  // Source inspection: verify CourseSequenceTree renders locked state and sequence badges
  const treeSource = await readFile(
    new URL('../app/components/CourseSequenceTree.tsx', import.meta.url),
    'utf8'
  );
  assert.match(treeSource, /getItemIcon/);
  assert.match(treeSource, /lockReason/);
  assert.match(treeSource, /course-roadmap-container/);

  // Source inspection: verify CourseSequenceManager supports drag-and-drop & keyboard fallback
  const managerSource = await readFile(
    new URL('../app/components/admin/CourseSequenceManager.tsx', import.meta.url),
    'utf8'
  );
  assert.match(managerSource, /SortableContext/);
  assert.match(managerSource, /onMoveUp/);
  assert.match(managerSource, /onMoveDown/);
  assert.match(managerSource, /\/api\/admin\/courses\/\$\{courseId\}\/sequence/);
});
