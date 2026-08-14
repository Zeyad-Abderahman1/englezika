import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { Database } from '../app/lib/database.ts';
import {
  generateLectureAccessCode,
  hashLectureAccessCode,
  normalizeLectureAccessCode,
  redeemLectureAccessCode,
} from '../app/lib/lecture-access-codes.ts';

const enabled = process.env.LECTURE_CODE_INTEGRATION_TEST === '1' && Boolean(process.env.DATABASE_URL);

test('PostgreSQL atomically permits one of 50 concurrent redemptions', { skip: !enabled }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  const db = new Database(pool);
  const suffix = crypto.randomUUID();
  const courseId = `code-test-course-${suffix}`;
  const videoId = `code-test-video-${suffix}`;
  const staffEmail = `code-test-staff-${suffix}@example.test`;
  const students = Array.from({ length: 50 }, (_, index) => `code-test-${index}-${suffix}@example.test`);
  const accessCodeId = `code-test-access-${suffix}`;
  const code = generateLectureAccessCode();
  const normalizedCode = normalizeLectureAccessCode(code);
  assert.ok(normalizedCode);

  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
       VALUES ($1, 'Concurrency course', 'Test', '', 0, 'published', $2, $2)`,
      [courseId, now]
    );
    await pool.query(
      `INSERT INTO videos (id, course_id, title, source_type, youtube_id, duration_seconds, status, created_at)
       VALUES ($1, $2, 'Concurrency video', 'youtube', 'dQw4w9WgXcQ', 120, 'published', $3)`,
      [videoId, courseId, now]
    );
    await pool.query(
      `INSERT INTO staff_users
       (email, name, role, permissions, password_hash, password_salt, password_iterations, active, created_by, created_at, updated_at)
       VALUES ($1, 'Test staff', 'teacher', '[]', '', '', 1, 1, $1, $2, $2)`,
      [staffEmail, now]
    );
    for (const email of students) {
      await pool.query(
        `INSERT INTO users (email, name, role, created_at, updated_at) VALUES ($1, 'Test student', 'student', $2, $2)`,
        [email, now]
      );
    }
    await pool.query(
      `INSERT INTO lecture_access_codes
       (id, code_hash, display_suffix, course_id, video_id, created_by_staff_email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        accessCodeId,
        await hashLectureAccessCode(normalizedCode),
        normalizedCode.slice(-5),
        courseId,
        videoId,
        staffEmail,
        now,
      ]
    );

    const results = await Promise.all(
      students.map((email) => redeemLectureAccessCode(db, email, code))
    );
    assert.equal(results.filter((result) => result.status === 'success').length, 1);
    const owner = await pool.query(
      'SELECT redeemed_by_student_email FROM lecture_access_codes WHERE id = $1',
      [accessCodeId]
    );
    const grants = await pool.query(
      'SELECT student_email FROM student_video_access_grants WHERE source_access_code_id = $1',
      [accessCodeId]
    );
    assert.equal(owner.rowCount, 1);
    assert.equal(grants.rowCount, 1);
    assert.equal(owner.rows[0].redeemed_by_student_email, grants.rows[0].student_email);
  } finally {
    await pool.query('DELETE FROM student_video_access_grants WHERE video_id = $1', [videoId]);
    await pool.query('DELETE FROM lecture_access_codes WHERE id = $1', [accessCodeId]);
    await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [students]);
    await pool.query('DELETE FROM videos WHERE id = $1', [videoId]);
    await pool.query('DELETE FROM courses WHERE id = $1', [courseId]);
    await pool.query('DELETE FROM staff_users WHERE email = $1', [staffEmail]);
    await pool.end();
  }
});

test('PostgreSQL does not consume a code when the student already has the video grant', { skip: !enabled }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = new Database(pool);
  const suffix = crypto.randomUUID();
  const courseId = `code-existing-course-${suffix}`;
  const videoId = `code-existing-video-${suffix}`;
  const staffEmail = `code-existing-staff-${suffix}@example.test`;
  const studentEmail = `code-existing-student-${suffix}@example.test`;
  const accessCodeId = `code-existing-access-${suffix}`;
  const existingGrantId = `code-existing-grant-${suffix}`;
  const code = generateLectureAccessCode();
  const normalizedCode = normalizeLectureAccessCode(code);
  assert.ok(normalizedCode);

  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
       VALUES ($1, 'Existing grant course', 'Test', '', 0, 'published', $2, $2)`,
      [courseId, now]
    );
    await pool.query(
      `INSERT INTO videos (id, course_id, title, source_type, youtube_id, duration_seconds, status, created_at)
       VALUES ($1, $2, 'Existing grant video', 'youtube', 'dQw4w9WgXcQ', 120, 'published', $3)`,
      [videoId, courseId, now]
    );
    await pool.query(
      `INSERT INTO staff_users
       (email, name, role, permissions, password_hash, password_salt, password_iterations, active, created_by, created_at, updated_at)
       VALUES ($1, 'Test staff', 'teacher', '[]', '', '', 1, 1, $1, $2, $2)`,
      [staffEmail, now]
    );
    await pool.query(
      `INSERT INTO users (email, name, role, created_at, updated_at)
       VALUES ($1, 'Test student', 'student', $2, $2)`,
      [studentEmail, now]
    );
    await pool.query(
      `INSERT INTO lecture_access_codes
       (id, code_hash, display_suffix, course_id, video_id, created_by_staff_email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accessCodeId, await hashLectureAccessCode(normalizedCode), normalizedCode.slice(-5), courseId, videoId, staffEmail, now]
    );
    await pool.query(
      `INSERT INTO student_video_access_grants
       (id, student_email, video_id, source, source_access_code_id, created_at)
       VALUES ($1, $2, $3, 'one_time_code', NULL, $4)`,
      [existingGrantId, studentEmail, videoId, now]
    );

    assert.equal((await redeemLectureAccessCode(db, studentEmail, code)).status, 'invalid_code');
    const codeState = await pool.query(
      'SELECT redeemed_at, redeemed_by_student_email FROM lecture_access_codes WHERE id = $1',
      [accessCodeId]
    );
    assert.equal(codeState.rows[0].redeemed_at, null);
    assert.equal(codeState.rows[0].redeemed_by_student_email, null);
  } finally {
    await pool.query('DELETE FROM student_video_access_grants WHERE video_id = $1', [videoId]);
    await pool.query('DELETE FROM lecture_access_codes WHERE id = $1', [accessCodeId]);
    await pool.query('DELETE FROM users WHERE email = $1', [studentEmail]);
    await pool.query('DELETE FROM videos WHERE id = $1', [videoId]);
    await pool.query('DELETE FROM courses WHERE id = $1', [courseId]);
    await pool.query('DELETE FROM staff_users WHERE email = $1', [staffEmail]);
    await pool.end();
  }
});
