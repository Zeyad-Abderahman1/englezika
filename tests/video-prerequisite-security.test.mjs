import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class VideoAccessDatabase {
  bestPercentage = null;

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
        if (normalizedSql.startsWith('SELECT v.id, v.course_id AS courseId')) {
          return {
            id: this.bindings[0],
            courseId: 'course-1',
            sourceType: 'youtube',
            youtubeId: 'dQw4w9WgXcQ',
            durationSeconds: 120,
            title: 'Protected lesson',
            prerequisiteExamId: 'exam-1',
            minimumScore: 70,
            hasEnrollmentAccess: 1,
            hasIndividualGrant: 0,
          };
        }
        if (normalizedSql.startsWith('SELECT id FROM videos')) return null;
        if (normalizedSql.startsWith('SELECT MAX(CASE WHEN max_score > 0')) {
          return { bestPercentage: database.bestPercentage };
        }
        return null;
      }

      async all() {
        return { success: true, results: [], meta: { changes: 0 } };
      }

      async run() {
        return { success: true, results: [], meta: { changes: 0 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

test('every video access requires the configured prerequisite exam score', async () => {
  const db = new VideoAccessDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-video-access-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');
  db.bestPercentage = 69.9;
  const denied = await authorizeVideoAccess('student@example.test', 'lesson-1');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'LESSON_QUIZ_REQUIRED');

  db.bestPercentage = 70;
  assert.equal((await authorizeVideoAccess('student@example.test', 'lesson-1')).ok, true);

  const rawVideoRoute = await readFile(
    new URL('../app/api/videos/[id]/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(rawVideoRoute, /authorizeVideoAccess\(user\.email, id\)/);
  assert.doesNotMatch(rawVideoRoute, /FROM videos WHERE id = \?/);
});
