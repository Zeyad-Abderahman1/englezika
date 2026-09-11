import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { courseService } from '../app/lib/services/course-service.ts';
import { lectureService } from '../app/lib/services/lecture-service.ts';
import { assessmentService } from '../app/lib/services/assessment-service.ts';
import { announcementService } from '../app/lib/services/announcement-service.ts';
import { DomainError } from '../app/lib/services/types.ts';

class MockDatabase {
  tables = {
    courses: new Map(),
    course_items: new Map(),
    videos: new Map(),
    exams: new Map(),
    questions: new Map(),
    attempts: new Map(),
    assignments: new Map(),
    assignment_questions: new Map(),
    assignment_submissions: new Map(),
    lecture_materials: new Map(),
    announcements: new Map(),
    notification_reads: new Map(),
    audit_logs: [],
  };

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('FROM courses WHERE id = ?')) {
              const row = db.tables.courses.get(args[0]);
              return row ? { id: row.id, title: row.title, thumbnailKey: row.thumbnail_key ?? null } : null;
            }
            if (sql.includes('FROM videos WHERE id = ?')) {
              const row = db.tables.videos.get(args[0]);
              return row
                ? {
                    id: row.id,
                    courseId: row.course_id,
                    title: row.title,
                    prerequisiteExamId: row.prerequisite_exam_id ?? null,
                    minimumScore: row.minimum_score ?? 0,
                    maxViews: row.max_views ?? null,
                  }
                : null;
            }
            if (sql.includes('FROM exams WHERE id = ?')) {
              const row = db.tables.exams.get(args[0]);
              return row
                ? {
                    id: row.id,
                    courseId: row.course_id,
                    title: row.title,
                    description: row.description,
                    instructions: row.instructions,
                    durationMinutes: row.duration_minutes,
                    passingScore: row.passing_score,
                    maxAttempts: row.max_attempts,
                    status: row.status,
                    assessmentType: row.assessment_type ?? 'exam',
                    mode: row.mode ?? 'online',
                    teacherFileKey: row.teacher_file_key ?? null,
                  }
                : null;
            }
            if (sql.includes('FROM assignments WHERE id = ?')) {
              const row = db.tables.assignments.get(args[0]);
              return row
                ? {
                    id: row.id,
                    courseId: row.course_id,
                    title: row.title,
                    description: row.description,
                    dueAt: row.due_at ?? null,
                    maxScore: row.max_score ?? 0,
                    status: row.status,
                    type: row.type ?? 'pdf',
                    teacherFileKey: row.teacher_file_key ?? null,
                  }
                : null;
            }
            if (sql.includes('FROM announcements WHERE id = ?')) {
              const row = db.tables.announcements.get(args[0]);
              return row ? { id: row.id, title: row.title, body: row.body } : null;
            }
            if (sql.includes('FROM attempts WHERE exam_id = ? LIMIT 1')) {
              const found = Array.from(db.tables.attempts.values()).find((a) => a.exam_id === args[0]);
              return found ? { id: found.id } : null;
            }
            return null;
          },
          async all() {
            if (sql.includes('FROM questions WHERE exam_id = ?')) {
              const results = Array.from(db.tables.questions.values()).filter((q) => q.exam_id === args[0]);
              return { results, success: true, meta: { changes: results.length } };
            }
            if (sql.includes('FROM lecture_materials WHERE video_id = ?')) {
              const results = Array.from(db.tables.lecture_materials.values()).filter((m) => m.video_id === args[0]);
              return { results, success: true, meta: { changes: results.length } };
            }
            if (sql.includes('FROM assignment_questions WHERE assignment_id = ?')) {
              const results = Array.from(db.tables.assignment_questions.values()).filter(
                (q) => q.assignment_id === args[0]
              );
              return { results, success: true, meta: { changes: results.length } };
            }
            return { results: [], success: true, meta: { changes: 0 } };
          },
          async run() {
            if (sql.includes('INSERT INTO courses')) {
              const [id, title, grade, description, price, status] = args;
              db.tables.courses.set(id, { id, title, grade, description, price, status });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE courses SET title = ?')) {
              const [title, grade, description, price, status, , id] = args;
              const existing = db.tables.courses.get(id);
              if (!existing) return { results: [], success: true, meta: { changes: 0 } };
              db.tables.courses.set(id, { ...existing, title, grade, description, price, status });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO videos')) {
              const [id, course_id, title, source_url, youtube_id, duration_seconds, prerequisite_exam_id, minimum_score, max_views, status] = args;
              db.tables.videos.set(id, {
                id,
                course_id,
                title,
                source_url,
                youtube_id,
                duration_seconds,
                prerequisite_exam_id,
                minimum_score,
                max_views,
                status,
              });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE videos SET title = ?')) {
              const [title, prerequisite_exam_id, minimum_score, max_views, status, id] = args;
              const existing = db.tables.videos.get(id);
              if (!existing) return { results: [], success: true, meta: { changes: 0 } };
              db.tables.videos.set(id, { ...existing, title, prerequisite_exam_id, minimum_score, max_views, status });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO assignments')) {
              const [id, course_id, title, description, due_at, max_score, status, type] = args;
              db.tables.assignments.set(id, { id, course_id, title, description, due_at, max_score, status, type });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO announcements')) {
              const [id, title, body, status] = args;
              db.tables.announcements.set(id, { id, title, body, status });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE announcements SET title = ?')) {
              const [title, body, id] = args;
              const existing = db.tables.announcements.get(id);
              if (!existing) return { results: [], success: true, meta: { changes: 0 } };
              db.tables.announcements.set(id, { ...existing, title, body });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

class MockStorage {
  files = new Map();
  async get(key) {
    const data = this.files.get(key);
    if (!data) return null;
    return { body: data, size: data.byteLength };
  }
  async put(key, value) {
    this.files.set(key, value);
  }
  async delete(key) {
    this.files.delete(key);
  }
}

const mockStaff = {
  email: 'teacher@example.com',
  name: 'Teacher',
  role: 'teacher',
};

describe('Domain Services Parity & Regression Suite', () => {
  test('courseService: createCourse validates and inserts course', async () => {
    const db = new MockDatabase();
    const context = { db };

    // Validation: short title
    await assert.rejects(
      async () => courseService.createCourse({ title: 'ab', grade: 'First Secondary' }, mockStaff, context),
      (err) => err instanceof DomainError && err.status === 400
    );

    // Success: draft by default if requested
    const result = await courseService.createCourse(
      { title: 'Unit 4 Advanced English', grade: 'First Secondary', price: 150, status: 'draft' },
      mockStaff,
      context
    );
    assert.equal(result.ok, true);
    assert.ok(result.id);
    assert.equal(result.title, 'Unit 4 Advanced English');

    const created = db.tables.courses.get(result.id);
    assert.ok(created);
    assert.equal(created.status, 'draft');
    assert.equal(created.price, 150);
  });

  test('courseService: updateCourse updates existing course', async () => {
    const db = new MockDatabase();
    db.tables.courses.set('c-1', {
      id: 'c-1',
      title: 'Original Title',
      grade: 'Grade 1',
      description: '',
      price: 0,
      status: 'draft',
    });
    const context = { db };

    // Update non-existent
    await assert.rejects(
      async () => courseService.updateCourse('c-999', { title: 'New Title', grade: 'Grade 1' }, mockStaff, context),
      (err) => err instanceof DomainError && err.status === 404
    );

    // Update valid
    const updateResult = await courseService.updateCourse(
      'c-1',
      { title: 'Updated Unit 1', grade: 'Grade 1', price: 200, status: 'published' },
      mockStaff,
      context
    );
    assert.equal(updateResult.ok, true);
    const updated = db.tables.courses.get('c-1');
    assert.equal(updated.title, 'Updated Unit 1');
    assert.equal(updated.status, 'published');
  });

  test('lectureService: createLecture extracts YouTube ID and validates course', async () => {
    const db = new MockDatabase();
    db.tables.courses.set('c-1', { id: 'c-1', title: 'Course 1' });
    const context = { db };

    // Missing youtube URL
    await assert.rejects(
      async () =>
        lectureService.createLecture(
          { courseId: 'c-1', title: 'Lecture 1', youtubeUrl: 'invalid' },
          mockStaff,
          context
        ),
      (err) => err instanceof DomainError && err.status === 400
    );

    // Missing course
    await assert.rejects(
      async () =>
        lectureService.createLecture(
          { courseId: 'c-404', title: 'Lecture 1', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
          mockStaff,
          context
        ),
      (err) => err instanceof DomainError && err.status === 404
    );

    // Valid create
    const result = await lectureService.createLecture(
      {
        courseId: 'c-1',
        title: 'Grammar Lecture 1',
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        durationSeconds: 1800,
        maxViews: 3,
        status: 'published',
      },
      mockStaff,
      context
    );

    assert.equal(result.ok, true);
    assert.ok(result.id);
    const video = db.tables.videos.get(result.id);
    assert.ok(video);
    assert.equal(video.youtube_id, 'dQw4w9WgXcQ');
    assert.equal(video.max_views, 3);
  });

  test('assessmentService: createExam creates online exam with questions', async () => {
    const db = new MockDatabase();
    db.tables.courses.set('c-1', { id: 'c-1', title: 'Course 1' });
    const context = { db };

    // Validation: online exam requires questions
    await assert.rejects(
      async () =>
        assessmentService.createExam(
          {
            title: 'Quiz 1',
            courseId: 'c-1',
            mode: 'online',
            questions: [],
          },
          mockStaff,
          context
        ),
      (err) => err instanceof DomainError && err.status === 400
    );

    // Valid exam with MCQ
    const result = await assessmentService.createExam(
      {
        title: 'Unit 1 Grammar Quiz',
        courseId: 'c-1',
        assessmentType: 'quiz',
        mode: 'online',
        durationMinutes: 20,
        passingScore: 60,
        maxAttempts: 2,
        status: 'published',
        questions: [
          {
            prompt: 'Choose the correct form of the verb: She ___ to school every day.',
            options: ['go', 'goes', 'went', 'going'],
            correctAnswer: 'goes',
            explanation: 'Present simple third-person singular takes -es.',
            points: 1,
          },
        ],
      },
      mockStaff,
      context
    );

    assert.equal(result.ok, true);
    assert.ok(result.id);
    assert.equal(result.questionIds.length, 1);
  });

  test('assessmentService: createAssignment validates and inserts assignment', async () => {
    const db = new MockDatabase();
    db.tables.courses.set('c-1', { id: 'c-1', title: 'Course 1' });
    const context = { db };

    // Invalid course
    await assert.rejects(
      async () =>
        assessmentService.createAssignment(
          { courseId: 'c-404', title: 'Homework 1' },
          mockStaff,
          context
        ),
      (err) => err instanceof DomainError && err.status === 404
    );

    // Valid assignment
    const result = await assessmentService.createAssignment(
      {
        courseId: 'c-1',
        title: 'Week 1 Assignment',
        description: 'Solve the reading comprehension exercise.',
        maxScore: 20,
        status: 'draft',
        type: 'mcq',
      },
      mockStaff,
      context
    );

    assert.equal(result.ok, true);
    const created = db.tables.assignments.get(result.id);
    assert.ok(created);
    assert.equal(created.type, 'mcq');
    assert.equal(created.status, 'draft');
  });

  test('announcementService: create, update, and delete announcement', async () => {
    const db = new MockDatabase();
    const context = { db };

    // Validation: short title
    await assert.rejects(
      async () => announcementService.createAnnouncement({ title: 'ab', body: 'body text' }, mockStaff, context),
      (err) => err instanceof DomainError && err.status === 400
    );

    // Create
    const createResult = await announcementService.createAnnouncement(
      { title: 'Welcome to First Secondary', body: 'Welcome to the new academic year!' },
      mockStaff,
      context
    );
    assert.equal(createResult.ok, true);
    assert.ok(createResult.id);

    // Update
    const updateResult = await announcementService.updateAnnouncement(
      createResult.id,
      { title: 'Updated Welcome Title', body: 'Welcome everyone to English class!' },
      mockStaff,
      context
    );
    assert.equal(updateResult.ok, true);
    assert.equal(db.tables.announcements.get(createResult.id).title, 'Updated Welcome Title');

    // Delete
    const deleteResult = await announcementService.deleteAnnouncement(createResult.id, mockStaff, context);
    assert.equal(deleteResult.ok, true);
  });

  test('transaction capability: withTransaction executes multiple domain operations and handles rollback', async () => {
    class MockTransactionalDatabase extends MockDatabase {
      snapshot() {
        return {
          courses: new Map(this.tables.courses),
          videos: new Map(this.tables.videos),
        };
      }
      restore(snap) {
        this.tables.courses = snap.courses;
        this.tables.videos = snap.videos;
      }
      async withTransaction(callback) {
        const snap = this.snapshot();
        try {
          return await callback(this);
        } catch (error) {
          this.restore(snap);
          throw error;
        }
      }
    }

    const txDb = new MockTransactionalDatabase();

    // 1. Successful compound operation
    await txDb.withTransaction(async (db) => {
      const course = await courseService.createCourse(
        { title: 'Unit 5 Compound', grade: 'Grade 2', status: 'draft' },
        mockStaff,
        { db }
      );
      await lectureService.createLecture(
        {
          courseId: course.id,
          title: 'Lecture 1 in Unit 5',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          status: 'draft',
        },
        mockStaff,
        { db }
      );
    });

    assert.equal(txDb.tables.courses.size, 1);
    assert.equal(txDb.tables.videos.size, 1);

    // 2. Failed compound operation triggers rollback
    await assert.rejects(
      async () =>
        txDb.withTransaction(async (db) => {
          await courseService.createCourse(
            { title: 'Unit 6 Should Rollback', grade: 'Grade 2', status: 'draft' },
            mockStaff,
            { db }
          );
          // Deliberate error: invalid lecture
          await lectureService.createLecture(
            { courseId: 'non-existent', title: 'bad', youtubeUrl: 'bad' },
            mockStaff,
            { db }
          );
        }),
      DomainError
    );

    // After rollback: Unit 6 must not exist in database!
    const courseTitles = Array.from(txDb.tables.courses.values()).map((c) => c.title);
    assert.ok(!courseTitles.includes('Unit 6 Should Rollback'), 'Rolled back course must not exist');
    assert.equal(txDb.tables.courses.size, 1, 'Only original Unit 5 exists');
  });
});

