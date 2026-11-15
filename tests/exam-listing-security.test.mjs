import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe, afterEach } from 'node:test';

const listing = await import('../app/lib/exam-listing.ts');
const publicExam = await import('../app/lib/public-exam.ts');
const courseFilter = await import('../app/lib/course-filter.ts');
const { examListingService } = await import('../app/lib/services/exam-listing-service.ts');
const { DomainError } = await import('../app/lib/services/types.ts');
const { validateToolArguments } = await import('../app/lib/ai/tool-executor.ts');
const { getToolDefinition } = await import('../app/lib/ai/tool-registry.ts');
const leaderboardRoute = await import('../app/api/public/exams/[slug]/leaderboard/route.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ── Leaderboard rules (reference implementation mirrors LEADERBOARD_SQL) ───────

const student = (email, firstName, lastName, extra = {}) => ({ email, role: 'student', firstName, lastName, ...extra });
const attempt = (email, score, seconds, submittedAt, extra = {}) => ({
  email,
  status: 'submitted',
  score,
  maxScore: 10,
  startedAt: submittedAt - seconds * 1000,
  submittedAt,
  ...extra,
});

describe('display names are masked for the public page', () => {
  test('first name + first letter of last name; never email, phone, id or full name', () => {
    assert.equal(listing.maskDisplayName({ firstName: 'أحمد', lastName: 'محمود' }), 'أحمد م.');
    assert.equal(listing.maskDisplayName({ firstName: 'Sara', lastName: 'Ali' }), 'Sara A.');
    assert.equal(listing.maskDisplayName({ firstName: 'منى', lastName: '' }), 'منى');
    assert.equal(listing.maskDisplayName({ fullName: 'محمد علي حسن' }), 'محمد ح.');
    assert.equal(listing.maskDisplayName({ firstName: 'a@b.com', lastName: 'x' }).includes('@'), false);
    assert.equal(listing.maskDisplayName({}), listing.ANONYMOUS_STUDENT_LABEL);
  });

  test('opted-out students are anonymous', () => {
    assert.equal(listing.maskDisplayName({ firstName: 'أحمد', lastName: 'محمود', hidden: true }), 'طالب مجهول');
  });
});

describe('leaderboard ranking', () => {
  const students = [
    student('a@x.com', 'أحمد', 'محمود'),
    student('b@x.com', 'بسمة', 'علي'),
    student('c@x.com', 'كريم', 'سعيد', { hidden: true }),
    { email: 'teacher@x.com', role: 'teacher', firstName: 'Mr', lastName: 'Teacher' },
  ];

  test('best attempt per student, retakes do not create extra rows', () => {
    const rows = listing.rankLeaderboardReference(
      [attempt('a@x.com', 5, 100, 1000), attempt('a@x.com', 9, 300, 2000), attempt('a@x.com', 7, 50, 3000), attempt('b@x.com', 8, 100, 1500)],
      students
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => [row.displayName, row.score]), [['أحمد م.', 9], ['بسمة ع.', 8]]);
  });

  test('ties break by shorter time, then earlier submission, deterministically', () => {
    const attempts = [
      attempt('a@x.com', 8, 200, 5000),
      attempt('b@x.com', 8, 100, 9000),
      attempt('c@x.com', 8, 100, 4000),
    ];
    const first = listing.rankLeaderboardReference(attempts, students).map((row) => row.displayName);
    const second = listing.rankLeaderboardReference([...attempts].reverse(), students).map((row) => row.displayName);
    assert.deepEqual(first, ['طالب مجهول', 'بسمة ع.', 'أحمد م.']);
    assert.deepEqual(second, first, 'same order regardless of input order');
  });

  test('incomplete, terminated and zero-max attempts are excluded', () => {
    const rows = listing.rankLeaderboardReference(
      [
        attempt('a@x.com', 9, 10, 1, { status: 'terminated' }),
        attempt('b@x.com', 9, 10, 1, { status: 'in_progress' }),
        attempt('c@x.com', 0, 10, 1, { maxScore: 0 }),
      ],
      students
    );
    assert.deepEqual(rows, []);
  });

  test('staff accounts and unknown users never appear', () => {
    const rows = listing.rankLeaderboardReference(
      [attempt('teacher@x.com', 10, 5, 1), attempt('ghost@x.com', 10, 5, 1), attempt('a@x.com', 6, 100, 1)],
      students
    );
    assert.deepEqual(rows.map((row) => row.displayName), ['أحمد م.']);
  });

  test('opted-out students keep their rank but are anonymous', () => {
    const rows = listing.rankLeaderboardReference(
      [attempt('c@x.com', 10, 10, 1), attempt('a@x.com', 6, 10, 1)],
      students
    );
    assert.equal(rows[0].rank, 1);
    assert.equal(rows[0].displayName, 'طالب مجهول');
    assert.equal(rows[1].rank, 2);
  });

  test('top 10 only; fewer than 10 and zero students are fine', () => {
    const many = Array.from({ length: 25 }, (_, i) => student(`s${i}@x.com`, `طالب${i}`, 'أ'));
    const attempts = many.map((s, i) => attempt(s.email, (i % 10) + 1, 60 + i, 1000 + i));
    assert.equal(listing.rankLeaderboardReference(attempts, many).length, 10);
    assert.equal(listing.rankLeaderboardReference(attempts.slice(0, 3), many).length, 3);
    assert.deepEqual(listing.rankLeaderboardReference([], many), []);
  });

  test('public rows carry no identifiers at all', () => {
    const [row] = listing.rankLeaderboardReference([attempt('a@x.com', 9, 61, 1)], students);
    assert.deepEqual(Object.keys(row).sort(), ['displayName', 'maxScore', 'percentage', 'rank', 'score', 'timeSeconds']);
    assert.equal(row.timeSeconds, 61);
    assert.equal(listing.formatDuration(61), '1:01');
  });

  test('the SQL enforces the same rules and is limited server-side', () => {
    const sql = publicExam.LEADERBOARD_SQL;
    assert.match(sql, /DISTINCT ON \(a\.user_email\)/);
    assert.match(sql, /a\.status = 'submitted'/);
    assert.match(sql, /u\.role = 'student'/);
    assert.match(sql, /LIMIT 10/);
    assert.match(sql, /ORDER BY b\.pct DESC, b\.duration_ms ASC, b\.submitted_at ASC, b\.user_email ASC/);
    assert.match(read('../database/migrations/013_exam_course_listing.sql'), /attempts_leaderboard_idx/);
  });
});

describe('slug generation', () => {
  test('readable, URL-safe, unique suffix', () => {
    assert.equal(listing.slugifyExamTitle('امتحان شامل — الوحدة 1!', 'ab12c'), 'امتحان-شامل-الوحدة-1-ab12c');
    assert.equal(listing.slugifyExamTitle('###', 'x9'), 'exam-x9');
    assert.ok(!/[\s/?#]/.test(listing.slugifyExamTitle('a b/c?d#e', 'zz')));
  });
});

// ── Fake database / storage ────────────────────────────────────────────────────

function makeWorld() {
  const world = {
    exams: new Map(),
    courses: new Map(),
    attempts: [],
    students: [],
    sql: [],
    files: new Map(),
  };

  const db = {
    async withTransaction(callback) {
      return callback(db);
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
    prepare(sql) {
      const run = (values) => ({
        values,
        async first() {
          world.sql.push(sql);
          if (sql.includes('INSERT INTO rate_limits')) return { count: 1, resetAt: Date.now() + 60_000 };
          if (sql.includes('FROM exams WHERE id = ?')) {
            const exam = world.exams.get(values[0]);
            return exam ? { ...exam } : null;
          }
          if (sql.includes('FROM exams x LEFT JOIN courses c ON c.id = x.listing_course_id') && sql.includes('x.public_slug = ?')) {
            const exam = [...world.exams.values()].find((e) => e.publicSlug === values[0]);
            // emulate the WHERE of the real query
            if (!exam || exam.status !== 'published' || !exam.publishedAsCourse || !exam.isPublic) return null;
            const course = world.courses.get(exam.listingCourseId);
            return {
              id: exam.id,
              slug: exam.publicSlug,
              title: exam.title,
              description: exam.description,
              durationMinutes: 30,
              passingScore: 50,
              questionCount: 12,
              price: course?.price ?? 0,
              listingCourseId: exam.listingCourseId,
              hasThumbnail: Boolean(exam.thumbnailKey),
              showLeaderboard: exam.showLeaderboard,
              mode: 'online',
              assessmentType: 'exam',
              updatedAt: 1,
            };
          }
          if (sql.includes('FROM exams x LEFT JOIN courses c ON c.id = x.listing_course_id') && sql.includes('WHERE x.id = ?')) {
            const exam = world.exams.get(values[0]);
            if (!exam) return null;
            return {
              publishedAsCourse: exam.publishedAsCourse,
              listingCourseId: exam.listingCourseId,
              publicSlug: exam.publicSlug,
              isPublic: exam.isPublic,
              showLeaderboard: exam.showLeaderboard,
              thumbnailKey: exam.thumbnailKey,
              price: world.courses.get(exam.listingCourseId)?.price ?? 0,
            };
          }
          if (sql.includes('SELECT id FROM courses WHERE id = ?')) {
            return world.courses.has(values[0]) ? { id: values[0] } : null;
          }
          if (sql.includes('SELECT 1 AS found FROM exams WHERE public_slug = ?')) {
            return [...world.exams.values()].some((e) => e.publicSlug === values[0]) ? { found: 1 } : null;
          }
          return null;
        },
        async all() {
          world.sql.push(sql);
          if (sql.includes('WITH best AS')) {
            const rows = listing.rankLeaderboardRawReference(world.attempts, world.students);
            return { results: rows, success: true, meta: { changes: rows.length } };
          }
          return { results: [], success: true, meta: { changes: 0 } };
        },
        async run() {
          world.sql.push(sql);
          if (sql.includes('INSERT INTO courses')) {
            const [id, title, grade, description, price, thumbnailKey] = values;
            world.courses.set(id, { id, title, grade, description, price, status: 'published', kind: 'exam', allGrades: true, thumbnailKey });
          } else if (sql.startsWith('UPDATE courses SET title')) {
            const [title, grade, description, price, thumbnailKey, , id] = values;
            Object.assign(world.courses.get(id), { title, grade, description, price, thumbnailKey, status: 'published' });
          } else if (sql.includes("UPDATE exams SET status = 'published', published_as_course = true")) {
            const [courseId, slug, isPublic, showLeaderboard, , id] = values;
            Object.assign(world.exams.get(id), {
              status: 'published',
              publishedAsCourse: true,
              listingCourseId: courseId,
              publicSlug: slug,
              isPublic: Boolean(isPublic),
              showLeaderboard: Boolean(showLeaderboard),
            });
          } else if (sql.includes('UPDATE exams SET published_as_course = false')) {
            world.exams.get(values[1]).publishedAsCourse = false;
          } else if (sql.includes("UPDATE courses SET status = 'draft'")) {
            world.courses.get(values[1]).status = 'draft';
          } else if (sql.includes('UPDATE exams SET thumbnail_key = ?')) {
            world.exams.get(values[2]).thumbnailKey = values[0];
          } else if (sql.includes('UPDATE exams SET thumbnail_key = NULL')) {
            world.exams.get(values[1]).thumbnailKey = null;
          } else if (sql.includes('UPDATE courses SET thumbnail_key = ?')) {
            world.courses.get(values[2]).thumbnailKey = values[0];
          } else if (sql.includes('UPDATE courses SET thumbnail_key = NULL')) {
            world.courses.get(values[1]).thumbnailKey = null;
          }
          return { results: [], success: true, meta: { changes: 1 } };
        },
      });
      return { bind: (...values) => run(values), ...run([]) };
    },
  };

  const storage = {
    async put(key, bytes) {
      world.files.set(key, bytes);
    },
    async get(key) {
      const body = world.files.get(key);
      return body ? { body, size: body.byteLength } : null;
    },
    async delete(key) {
      world.files.delete(key);
    },
  };

  world.db = db;
  world.storage = storage;
  return world;
}

function install(world) {
  globalThis.__ENGLIZEKA_ENV__ = { DB: world.db, STORAGE: world.storage };
  publicExam.invalidatePublicExamCache();
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
  publicExam.invalidatePublicExamCache();
});

const operator = { email: 'teacher@x.com', role: 'teacher' };

function seedExam(world, overrides = {}) {
  const exam = {
    id: 'exam-1',
    title: 'امتحان شامل على الوحدة الأولى',
    description: '',
    status: 'published',
    thumbnailKey: null,
    listingCourseId: null,
    publicSlug: null,
    publishedAsCourse: false,
    isPublic: false,
    showLeaderboard: true,
    ...overrides,
  };
  world.exams.set(exam.id, exam);
  return exam;
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(97);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes.buffer;
}

describe('publishing an exam as an all-classes course (shared service)', () => {
  test('creates ONE wrapper course for all classes with price, slug and public flags', async () => {
    const world = makeWorld();
    seedExam(world);
    install(world);

    const state = await examListingService.publishAsCourse(
      'exam-1',
      { price: '150', description: 'وصف قصير', isPublic: true, showLeaderboard: true },
      operator
    );

    assert.equal(state.publishedAsCourse, true);
    assert.equal(world.courses.size, 1);
    const course = [...world.courses.values()][0];
    assert.equal(course.kind, 'exam');
    assert.equal(course.allGrades, true);
    assert.equal(course.grade, 'كل الصفوف');
    assert.equal(course.price, 150);
    assert.ok(state.publicSlug && state.publicSlug.length > 5);
    assert.equal(world.exams.get('exam-1').listingCourseId, course.id);
  });

  test('publishing twice reuses the same listing (no duplicates) and unpublish hides it but keeps data', async () => {
    const world = makeWorld();
    seedExam(world);
    install(world);

    const first = await examListingService.publishAsCourse('exam-1', { price: 50 }, operator);
    const second = await examListingService.publishAsCourse('exam-1', { price: 80 }, operator);
    assert.equal(world.courses.size, 1, 'only one active listing per exam');
    assert.equal(first.listingCourseId, second.listingCourseId);
    assert.equal(first.publicSlug, second.publicSlug, 'slug is stable');
    assert.equal([...world.courses.values()][0].price, 80);

    const hidden = await examListingService.unpublish('exam-1', operator);
    assert.equal(hidden.publishedAsCourse, false);
    assert.equal([...world.courses.values()][0].status, 'draft');
    assert.equal(world.exams.get('exam-1').listingCourseId, first.listingCourseId, 'link is kept for re-publishing');
  });

  test('invalid input is rejected or clamped like the course form', async () => {
    const world = makeWorld();
    seedExam(world);
    install(world);
    await examListingService.publishAsCourse('exam-1', { price: -5 }, operator);
    assert.equal([...world.courses.values()][0].price, 0);
    await assert.rejects(examListingService.publishAsCourse('missing', {}, operator), (e) => e instanceof DomainError && e.status === 404);
  });
});

describe('exam thumbnail (stored once on the exam)', () => {
  test('valid image is stored, the listing course points at the same key, and replace deletes the old file', async () => {
    const world = makeWorld();
    seedExam(world);
    install(world);
    await examListingService.publishAsCourse('exam-1', {}, operator);

    const first = await examListingService.setThumbnail('exam-1', pngHeader(1280, 720), 'image/png', operator);
    assert.equal(first.notWidescreen, false);
    const key = world.exams.get('exam-1').thumbnailKey;
    assert.ok(key.startsWith('exams/exam-1/thumbnail/'));
    assert.equal([...world.courses.values()][0].thumbnailKey, key, 'one stored file, referenced twice');
    assert.equal(world.files.size, 1);

    const second = await examListingService.setThumbnail('exam-1', pngHeader(800, 800), 'image/png', operator);
    assert.equal(second.notWidescreen, true, 'other ratios only produce a gentle note');
    assert.equal(world.files.size, 1, 'old file removed on replace');
    assert.notEqual(world.exams.get('exam-1').thumbnailKey, key);

    await examListingService.deleteThumbnail('exam-1', operator);
    assert.equal(world.files.size, 0);
    assert.equal(world.exams.get('exam-1').thumbnailKey, null);
    assert.equal([...world.courses.values()][0].thumbnailKey, null);
  });

  test('wrong type, tiny and oversize files are rejected with Arabic messages', async () => {
    const world = makeWorld();
    seedExam(world);
    install(world);
    await assert.rejects(
      examListingService.setThumbnail('exam-1', new TextEncoder().encode('not an image at all').buffer, 'image/png', operator),
      /JPG أو PNG أو WebP/
    );
    await assert.rejects(examListingService.setThumbnail('exam-1', pngHeader(100, 50), 'image/png', operator), /أبعاد/);
    await assert.rejects(examListingService.setThumbnail('exam-1', new ArrayBuffer(6 * 1024 * 1024), 'image/png', operator), /5 ميجابايت/);
    assert.equal(world.files.size, 0);
  });
});

describe('public leaderboard API (no login)', () => {
  const call = (slug) =>
    leaderboardRoute.GET(new Request(`http://localhost/api/public/exams/${slug}/leaderboard`), {
      params: Promise.resolve({ slug }),
    });

  function worldWithPublicExam(overrides = {}) {
    const world = makeWorld();
    seedExam(world, {
      publishedAsCourse: true,
      isPublic: true,
      publicSlug: 'امتحان-ab12c',
      listingCourseId: 'course-1',
      ...overrides,
    });
    world.courses.set('course-1', { id: 'course-1', price: 0 });
    world.students = [student('a@x.com', 'أحمد', 'محمود'), student('b@x.com', 'بسمة', 'علي', { hidden: true })];
    world.attempts = [attempt('a@x.com', 9, 100, 1000), attempt('b@x.com', 7, 80, 2000)];
    return world;
  }

  test('works without a session and returns only rank, display name, score, percentage and time', async () => {
    const world = worldWithPublicExam();
    install(world);
    const response = await call('امتحان-ab12c');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.leaderboard.length, 2);
    assert.deepEqual(Object.keys(body.leaderboard[0]).sort(), ['displayName', 'maxScore', 'percentage', 'rank', 'score', 'timeSeconds']);
    assert.equal(body.leaderboard[1].displayName, 'طالب مجهول');
    const text = JSON.stringify(body);
    assert.equal(/@|x\.com|phone|email|school/i.test(text), false, 'no identifiers anywhere');
  });

  test('unpublished, non-public or unknown exams are 404', async () => {
    for (const overrides of [{ publishedAsCourse: false }, { isPublic: false }, { status: 'draft' }]) {
      install(worldWithPublicExam(overrides));
      assert.equal((await call('امتحان-ab12c')).status, 404, JSON.stringify(overrides));
    }
    install(worldWithPublicExam());
    assert.equal((await call('does-not-exist')).status, 404);
  });

  test('teacher can switch the leaderboard off per exam', async () => {
    install(worldWithPublicExam({ showLeaderboard: false }));
    assert.equal((await call('امتحان-ab12c')).status, 404);
  });

  test('zero students gives an empty list', async () => {
    const world = worldWithPublicExam();
    world.attempts = [];
    install(world);
    const body = await (await call('امتحان-ab12c')).json();
    assert.deepEqual(body.leaderboard, []);
  });

  test('the public queries never select exam content or personal data', () => {
    const source = read('../app/lib/public-exam.ts');
    const publicQuery = source.slice(source.indexOf('async function queryPublicExam'), source.indexOf('export async function getPublicExam'));
    assert.match(publicQuery, /x\.published_as_course = true AND x\.is_public = true/);
    assert.match(publicQuery, /x\.status = 'published'/);
    assert.equal(/prompt|options|correct_answer|explanation|email|phone|school/i.test(publicQuery.replace(/FROM questions q WHERE q\.exam_id = x\.id/, '')), false);
    assert.equal(/u\.email|u\.phone|school_name|user_email AS/.test(publicExam.LEADERBOARD_SQL.replace(/a\.user_email|b\.user_email|u\.email = b\.user_email/g, '')), false);
  });

  test('the public page needs no session and never renders questions', () => {
    const page = read('../app/exams/[slug]/page.tsx');
    assert.equal(page.includes('requireStudentUser'), false);
    assert.match(page, /notFound\(\)/);
    assert.equal(/correct_answer|correctAnswer|\.options|explanation/.test(page), false);
    assert.match(page, /getOptionalStudentEmail/);
    assert.match(page, /openGraph/);
  });
});

describe('students of every class see all-classes items', () => {
  const courses = [
    { id: 'a', grade: 'أولى ثانوي' },
    { id: 'b', grade: 'تالتة ثانوي' },
    { id: 'exam', grade: 'كل الصفوف', allGrades: true },
    { id: 'other', grade: 'إعدادي' },
  ];

  test('an all-classes exam appears under every class tab', () => {
    for (const tab of ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي']) {
      assert.ok(courseFilter.filterCoursesByTab(courses, tab).some((course) => course.id === 'exam'), tab);
    }
    assert.ok(courseFilter.filterCoursesByTab(courses, 'الكل').some((course) => course.id === 'exam'));
    assert.equal(courseFilter.filterCoursesByTab(courses, 'أولى ثانوي').some((course) => course.id === 'b'), false);
    assert.deepEqual(courseFilter.filterCoursesByTab(courses, 'أخرى').map((course) => course.id), ['other']);
  });

  test('exam access SQL honours the listing enrollment in every student query', () => {
    const files = [
      '../app/lib/exam-access.ts',
      '../app/api/dashboard/route.ts',
      '../app/api/notifications/read/route.ts',
      '../app/api/student/exams/[id]/file/route.ts',
    ];
    for (const file of files) {
      const source = read(file);
      assert.match(source, /e\.course_id = x\.listing_course_id/, `${file} joins the listing enrollment`);
      assert.match(source, /x\.published_as_course = false AND x\.course_id IS NULL/, `${file} gates listed exams`);
      assert.equal(/\(x\.course_id IS NULL OR e\.id IS NOT NULL\)/.test(source), false, `${file} has no legacy open-access clause`);
    }
  });
});

describe('every exam creation path can set the thumbnail and publish option', () => {
  test('manual form, OCR modal and PDF generator render the shared section and apply it after saving', () => {
    for (const file of [
      '../app/components/admin/domains/ExamsManagerView.tsx',
      '../app/components/admin/AIExamOcrModal.tsx',
      '../app/components/admin/ai/PdfAssessmentWorkspace.tsx',
    ]) {
      const source = read(file);
      assert.match(source, /<PublishExamAsCourse/, `${file} renders the shared section`);
      assert.match(source, /applyExamPublishing\(/, `${file} applies it through the shared helper`);
    }
    assert.match(read('../app/components/admin/domains/ExamsManagerView.tsx'), /<ExamPublishingModal/, 'edit screen for existing exams');
  });

  test('the shared client helper only talks to the endpoints that wrap the single service', () => {
    const helper = read('../app/lib/exam-publishing-client.ts');
    assert.match(helper, /\/thumbnail/);
    assert.match(helper, /\/listing/);
    for (const route of ['../app/api/admin/exams/[id]/listing/route.ts', '../app/api/admin/exams/[id]/thumbnail/route.ts']) {
      assert.match(read(route), /examListingService/);
    }
  });

  test('the AI assistant exam tools accept the same fields and go through the same service', () => {
    for (const tool of ['create_exam', 'create_quiz']) {
      const definition = getToolDefinition(tool);
      assert.doesNotThrow(() =>
        validateToolArguments(definition, {
          courseId: 'c1',
          title: 'Exam title',
          questions: [],
          publishAsCourse: true,
          listingPrice: 100,
          listingDescription: 'x',
          isPublic: true,
          showLeaderboard: false,
          thumbnailUploadId: '11111111-1111-4111-8111-111111111111.png',
        })
      );
      assert.throws(() => validateToolArguments(definition, { courseId: 'c1', title: 'Exam title', questions: [], hacker: 1 }));
      assert.throws(() => validateToolArguments(definition, { courseId: 'c1', title: 'Exam title', questions: [], publishAsCourse: 'yes' }));
    }
    assert.match(read('../app/lib/ai/tool-executor.ts'), /examListingService\.publishAsCourse/);
  });
});
