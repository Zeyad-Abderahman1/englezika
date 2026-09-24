import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { Database } from '../app/lib/database.ts';
import { lectureService } from '../app/lib/services/lecture-service.ts';
import { POST as createVideoRoute } from '../app/api/admin/videos/route.ts';
import { PATCH as updateVideoRoute } from '../app/api/admin/videos/[id]/route.ts';

const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  'postgresql://englizeka:englizeka_local_dev@127.0.0.1:5432/englizeka';

const mockStaff = {
  email: 'teacher@englizeka.local',
  name: 'أ. محمد عبد الرحمن',
  role: 'teacher',
  permissions: ['manage_courses', 'manage_videos'],
  isSuperAdmin: true,
};

test('Regression: Lecture maxViews=0 (unlimited) and maxViews=5 lifecycle against PostgreSQL', async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const client = await pool.connect();
  const db = new Database(pool);
  const context = { db };

  const now = Date.now();
  const courseId = `course-maxviews-test-${now}`;
  let lectureAId = '';
  let lectureBId = '';
  let lectureCId = '';

  try {
    // Setup test course in Postgres
    await client.query(
      `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
       VALUES ($1, 'Course for maxViews Test', 'Grade 3', 'Testing maxViews persistence', 0, 'published', $2, $2)`,
      [courseId, now]
    );

    // 1) Create lecture with maxViews=0 succeeds and stores 0 in Postgres
    const resA = await lectureService.createLecture(
      {
        courseId,
        title: 'Lecture A: Unlimited Views (maxViews=0)',
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        durationSeconds: 1200,
        maxViews: 0,
        status: 'published',
      },
      mockStaff,
      context
    );
    assert.equal(resA.ok, true);
    assert.ok(resA.id);
    lectureAId = resA.id;

    // Verify directly in PostgreSQL that max_views is 0 and NOT NULL
    const rowA = await client.query('SELECT id, max_views FROM videos WHERE id = $1', [lectureAId]);
    assert.equal(rowA.rows.length, 1);
    assert.strictEqual(rowA.rows[0].max_views, 0, 'PostgreSQL videos.max_views must be 0, not null');

    // 2) Create lecture with maxViews=5 succeeds and stores 5 in Postgres
    const resB = await lectureService.createLecture(
      {
        courseId,
        title: 'Lecture B: 5 Views Allowed (maxViews=5)',
        youtubeUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        durationSeconds: 900,
        maxViews: 5,
        status: 'published',
      },
      mockStaff,
      context
    );
    assert.equal(resB.ok, true);
    assert.ok(resB.id);
    lectureBId = resB.id;

    const rowB = await client.query('SELECT id, max_views FROM videos WHERE id = $1', [lectureBId]);
    assert.equal(rowB.rows.length, 1);
    assert.strictEqual(rowB.rows[0].max_views, 5, 'PostgreSQL videos.max_views must be 5');

    // 3) Update lecture from 5 to 0 succeeds and stores 0 in Postgres
    const updateBTo0 = await lectureService.updateLecture(
      lectureBId,
      {
        title: 'Lecture B: Updated to Unlimited (maxViews=0)',
        maxViews: 0,
      },
      mockStaff,
      context
    );
    assert.equal(updateBTo0.ok, true);

    const rowBUpdated = await client.query('SELECT id, max_views FROM videos WHERE id = $1', [lectureBId]);
    assert.strictEqual(rowBUpdated.rows[0].max_views, 0, 'Updating 5 to 0 must store 0 in PostgreSQL');

    // 4) Update lecture from 0 to 5 succeeds and stores 5 in Postgres
    const updateBTo5 = await lectureService.updateLecture(
      lectureBId,
      {
        title: 'Lecture B: Re-updated to 5 views (maxViews=5)',
        maxViews: 5,
      },
      mockStaff,
      context
    );
    assert.equal(updateBTo5.ok, true);

    const rowBReUpdated = await client.query('SELECT id, max_views FROM videos WHERE id = $1', [lectureBId]);
    assert.strictEqual(rowBReUpdated.rows[0].max_views, 5, 'Updating 0 to 5 must store 5 in PostgreSQL');

    // 5) Multiple different lectures can be created in the same course
    const resC = await lectureService.createLecture(
      {
        courseId,
        title: 'Lecture C: Third Lecture in Same Course',
        youtubeUrl: 'https://youtu.be/9bZkp7q19f0',
        durationSeconds: 600,
        maxViews: 10,
        status: 'published',
      },
      mockStaff,
      context
    );
    assert.equal(resC.ok, true);
    assert.ok(resC.id);
    lectureCId = resC.id;

    const courseVideos = await client.query(
      'SELECT id, title, max_views FROM videos WHERE course_id = $1 ORDER BY created_at ASC',
      [courseId]
    );
    assert.equal(courseVideos.rows.length, 3, 'All 3 different lectures must exist in the same course');
    assert.strictEqual(courseVideos.rows[0].max_views, 0, 'Lecture A has max_views=0');
    assert.strictEqual(courseVideos.rows[1].max_views, 5, 'Lecture B has max_views=5');
    assert.strictEqual(courseVideos.rows[2].max_views, 10, 'Lecture C has max_views=10');

  } finally {
    // Cleanup fixtures
    if (lectureAId || lectureBId || lectureCId) {
      await client.query('DELETE FROM videos WHERE course_id = $1', [courseId]);
    }
    await client.query('DELETE FROM courses WHERE id = $1', [courseId]);
    client.release();
    await pool.end();
  }
});

test('Regression: Admin video route handlers handle maxViews=0 and maxViews=5 without HTTP 500', async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const client = await pool.connect();
  const db = new Database(pool);

  // Set global DB for route handlers
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-video-access-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
  };

  const now = Date.now();
  const courseId = `route-test-course-${now}`;
  let videoId = '';

  const staffToken = 'test-staff-route-token-' + now;
  const tokenHash = await (async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode(staffToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  })();

  try {
    await client.query(
      `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
       VALUES ($1, 'Route Test Course', 'Grade 3', 'Testing Routes', 0, 'published', $2, $2)`,
      [courseId, now]
    );

    await client.query(
      `INSERT INTO staff_users (email, name, role, permissions, password_hash, password_salt, password_iterations, active, created_by, created_at, updated_at)
       VALUES ($1, 'Admin Staff', 'teacher', '["manage_videos","manage_courses"]', '', '', 1, 1, $1, $2, $2)
       ON CONFLICT (email) DO UPDATE SET active = 1`,
      ['admin-route-test@englizeka.local', now]
    );

    await client.query(
      `INSERT INTO staff_sessions (token_hash, staff_email, expires_at, created_at, last_seen)
       VALUES ($1, 'admin-route-test@englizeka.local', $2, $3, $3)`,
      [tokenHash, now + 3600000, now]
    );

    const headers = {
      'content-type': 'application/json',
      cookie: `englizeka_staff=${staffToken}`,
      origin: 'http://localhost:3000',
    };

    // 1) POST /api/admin/videos with maxViews: 0 (the exact payload from the form)
    const postReq = new Request('http://localhost:3000/api/admin/videos', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        courseId,
        title: 'Route Created Lecture Unlimited',
        durationSeconds: 600,
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        maxViews: 0,
      }),
    });

    const postRes = await createVideoRoute(postReq);
    assert.equal(postRes.status, 200, 'POST /api/admin/videos with maxViews=0 must return 200, not 500');
    const postBody = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.ok(postBody.id);
    videoId = postBody.id;

    // Verify stored max_views in Postgres is 0
    const row0 = await client.query('SELECT max_views FROM videos WHERE id = $1', [videoId]);
    assert.strictEqual(row0.rows[0].max_views, 0);

    // 2) PATCH /api/admin/videos/[id] to maxViews: 5
    const patchReq5 = new Request(`http://localhost:3000/api/admin/videos/${videoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: 'Route Updated Lecture 5 Views',
        maxViews: 5,
      }),
    });

    const patchRes5 = await updateVideoRoute(patchReq5, { params: Promise.resolve({ id: videoId }) });
    assert.equal(patchRes5.status, 200);
    const row5 = await client.query('SELECT max_views FROM videos WHERE id = $1', [videoId]);
    assert.strictEqual(row5.rows[0].max_views, 5);

    // 3) PATCH /api/admin/videos/[id] back to maxViews: 0
    const patchReq0 = new Request(`http://localhost:3000/api/admin/videos/${videoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: 'Route Updated Back To Unlimited',
        maxViews: 0,
      }),
    });

    const patchRes0 = await updateVideoRoute(patchReq0, { params: Promise.resolve({ id: videoId }) });
    assert.equal(patchRes0.status, 200);
    const rowFinal = await client.query('SELECT max_views FROM videos WHERE id = $1', [videoId]);
    assert.strictEqual(rowFinal.rows[0].max_views, 0);

  } finally {
    if (videoId) {
      await client.query('DELETE FROM videos WHERE id = $1', [videoId]);
    }
    await client.query('DELETE FROM staff_sessions WHERE token_hash = $1', [tokenHash]);
    await client.query('DELETE FROM staff_users WHERE email = $1', ['admin-route-test@englizeka.local']);
    await client.query('DELETE FROM courses WHERE id = $1', [courseId]);
    client.release();
    await pool.end();
  }
});
