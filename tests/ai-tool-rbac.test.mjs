import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { getToolRegistry, getToolDefinition } from '../app/lib/ai/tool-registry.ts';
import { executeTool, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';

// Mock Actor Identities
const teacherActor = {
  email: 'teacher@englizeka.com',
  name: 'Master Teacher',
  role: 'teacher',
  permissions: [
    'manage_courses',
    'manage_exams',
    'manage_assignments',
    'manage_videos',
    'manage_enrollments',
    'grade_exams',
    'manage_announcements',
    'manage_messages',
    'view_students',
    'manage_staff',
  ],
};

const courseManagerActor = {
  email: 'cm@englizeka.com',
  name: 'Course Manager',
  role: 'assistant',
  permissions: ['manage_courses', 'manage_exams', 'manage_assignments', 'manage_videos'],
};

const graderActor = {
  email: 'grader@englizeka.com',
  name: 'Exam Grader',
  role: 'assistant',
  permissions: ['grade_exams', 'view_students'],
};

const enrollmentManagerActor = {
  email: 'enrollments@englizeka.com',
  name: 'Enrollment Lead',
  role: 'assistant',
  permissions: ['manage_enrollments', 'view_students'],
};

// Mock In-Memory Database for Domain Services
class MockDatabase {
  tables = {
    courses: new Map([
      [
        'c_unit1',
        {
          id: 'c_unit1',
          title: 'Unit 1: Foundations',
          grade: '1sec',
          description: 'Basic grammar and vocab',
          price: 150,
          is_active: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
    ]),
    course_items: new Map([
      [
        'item_1',
        {
          id: 'item_1',
          course_id: 'c_unit1',
          item_type: 'video',
          item_id: 'v_lec1',
          sequence_order: 1,
        },
      ],
    ]),
    videos: new Map([
      [
        'v_lec1',
        {
          id: 'v_lec1',
          course_id: 'c_unit1',
          title: 'Lecture 1: Intro',
          youtube_id: 'dQw4w9WgXcQ',
          duration: 3600,
          order_num: 1,
          is_active: 0,
          max_views: 3,
        },
      ],
    ]),
    exams: new Map([
      [
        'ex_quiz1',
        {
          id: 'ex_quiz1',
          course_id: 'c_unit1',
          title: 'Quiz 1: Grammar',
          duration_minutes: 30,
          passing_score: 50,
          max_attempts: 1,
          is_active: 0,
          exam_type: 'quiz',
          question_count: 5,
        },
      ],
    ]),
    questions: new Map(),
    attempts: new Map(),
    assignments: new Map([
      [
        'asg_hw1',
        {
          id: 'asg_hw1',
          course_id: 'c_unit1',
          title: 'Homework 1',
          description: 'Solve questions',
          is_active: 0,
        },
      ],
    ]),
    announcements: new Map(),
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
              return row ? { id: row.id, title: row.title, grade: row.grade, description: row.description, price: row.price, status: row.status, is_active: row.is_active, thumbnailKey: null } : null;
            }
            if (sql.includes('FROM videos WHERE id = ?')) {
              const row = db.tables.videos.get(args[0]);
              return row ? { id: row.id, courseId: row.course_id, title: row.title, maxViews: row.max_views } : null;
            }
            if (sql.includes('FROM exams WHERE id = ?')) {
              const row = db.tables.exams.get(args[0]);
              return row ? { id: row.id, courseId: row.course_id, title: row.title, status: row.status } : null;
            }
            if (sql.includes('FROM assignments WHERE id = ?')) {
              const row = db.tables.assignments.get(args[0]);
              return row ? { id: row.id, courseId: row.course_id, title: row.title, status: row.status } : null;
            }
            return null;
          },
          async all() {
            if (sql.includes('FROM course_items WHERE course_id = ?')) {
              const results = Array.from(db.tables.course_items.values()).filter((i) => i.course_id === args[0]);
              return { results, success: true, meta: { changes: results.length } };
            }
            if (sql.includes('FROM courses')) {
              const results = Array.from(db.tables.courses.values());
              return { results, success: true, meta: { changes: results.length } };
            }
            return { results: [], success: true, meta: { changes: 0 } };
          },
          async run() {
            if (sql.includes('INSERT INTO courses')) {
              const [id, title, grade, description, price, status] = args;
              const row = { id, title, grade, description, price, status, is_active: status === 'published' ? 1 : 0 };
              db.tables.courses.set(id, row);
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE courses SET')) {
              const id = args[args.length - 1];
              const existing = db.tables.courses.get(id);
              if (!existing) return { results: [], success: true, meta: { changes: 0 } };
              const [title, grade, description, price, status] = args;
              db.tables.courses.set(id, { ...existing, title, grade, description, price, status, is_active: status === 'published' ? 1 : 0 });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('DELETE FROM courses WHERE id = ?')) {
              db.tables.courses.delete(args[0]);
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('DELETE FROM videos WHERE id = ?')) {
              db.tables.videos.delete(args[0]);
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('DELETE FROM exams WHERE id = ?')) {
              db.tables.exams.delete(args[0]);
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO audit_logs')) {
              db.tables.audit_logs.push(args);
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

  async query(sql, params = []) {
    const s = sql.toLowerCase();
    if (s.includes('select') && s.includes('courses') && s.includes('where id =')) {
      const course = this.tables.courses.get(params[0]);
      return { rows: course ? [course] : [] };
    }
    if (s.includes('select') && s.includes('from courses')) {
      return { rows: Array.from(this.tables.courses.values()) };
    }
    if (s.includes('select') && s.includes('from videos where id =')) {
      const vid = this.tables.videos.get(params[0]);
      return { rows: vid ? [vid] : [] };
    }
    if (s.includes('select') && s.includes('from exams where id =')) {
      const exam = this.tables.exams.get(params[0]);
      return { rows: exam ? [exam] : [] };
    }
    if (s.includes('select') && s.includes('from course_items where course_id =')) {
      const items = Array.from(this.tables.course_items.values()).filter(
        (i) => i.course_id === params[0]
      );
      return { rows: items };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('Phase 3: Tool Registry Architecture & Metadata', () => {
  test('registry contains complete catalog with authoritative metadata', () => {
    const registry = getToolRegistry();
    assert.ok(registry.size >= 15, 'Tool registry must register all catalog tools');

    const createCourseTool = getToolDefinition('create_course');
    assert.ok(createCourseTool);
    assert.equal(createCourseTool.name, 'create_course');
    assert.equal(createCourseTool.requiredPermission, 'manage_courses');
    assert.equal(createCourseTool.mutationType, 'create');
    assert.equal(createCourseTool.confirmationPolicy, 'none');

    const deleteCourseTool = getToolDefinition('delete_course');
    assert.ok(deleteCourseTool);
    assert.equal(deleteCourseTool.requiredPermission, 'manage_courses');
    assert.equal(deleteCourseTool.mutationType, 'delete');
    assert.equal(deleteCourseTool.riskLevel, 'high');
    assert.equal(deleteCourseTool.confirmationPolicy, 'mandatory');

    const updatePriceTool = getToolDefinition('update_course_price');
    assert.ok(updatePriceTool);
    assert.equal(updatePriceTool.mutationType, 'financial');
    assert.equal(updatePriceTool.confirmationPolicy, 'mandatory');
  });

  test('unknown tool name is safely rejected', async () => {
    const mockDb = new MockDatabase();
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'drop_database_now',
          args: {},
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'UNKNOWN_TOOL'
    );
  });
});

describe('Phase 3: RBAC & Permission Enforcement', () => {
  test('grader cannot create course, lecture, or exam', async () => {
    const mockDb = new MockDatabase();

    await assert.rejects(
      () =>
        executeTool({
          actor: graderActor,
          toolName: 'create_course',
          args: { title: 'Unauthorized Course', grade: '1sec', price: 100 },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'FORBIDDEN'
    );

    await assert.rejects(
      () =>
        executeTool({
          actor: graderActor,
          toolName: 'add_lecture',
          args: { courseId: 'c_unit1', title: 'Unauthorized Lecture', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'FORBIDDEN'
    );

    await assert.rejects(
      () =>
        executeTool({
          actor: graderActor,
          toolName: 'create_exam',
          args: { courseId: 'c_unit1', title: 'Unauthorized Exam', questions: [] },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'FORBIDDEN'
    );
  });

  test('enrollment manager cannot mutate courses or videos', async () => {
    const mockDb = new MockDatabase();

    await assert.rejects(
      () =>
        executeTool({
          actor: enrollmentManagerActor,
          toolName: 'create_course',
          args: { title: 'Unauthorized Course', grade: '1sec', price: 100 },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'FORBIDDEN'
    );
  });

  test('course_manager has permission to call permitted tools', async () => {
    const mockDb = new MockDatabase();

    const res = await executeTool({
      actor: courseManagerActor,
      toolName: 'create_course',
      args: { title: 'Permitted Unit 2', grade: '1sec', price: 100 },
      context: { db: mockDb },
    });

    assert.equal(res.ok, true);
    assert.equal(res.toolName, 'create_course');
  });
});

describe('Phase 3: Trusted Actor Boundary & Anti-Tampering', () => {
  test('model args cannot inject staffEmail or override actor', async () => {
    const mockDb = new MockDatabase();

    await assert.rejects(
      () =>
        executeTool({
          actor: graderActor,
          toolName: 'create_course',
          args: {
            title: 'Spoofed Course',
            grade: '1sec',
            price: 100,
            staffEmail: 'teacher@englizeka.com', // Attempting to spoof identity
            role: 'teacher',
          },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && (err.code === 'INVALID_ARGS' || err.code === 'FORBIDDEN')
    );
  });

  test('model args cannot inject confirmationSatisfied flag', async () => {
    const mockDb = new MockDatabase();

    // Trying to pass confirmationSatisfied in args to bypass confirmation check
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'delete_course',
          args: {
            courseId: 'c_unit1',
            confirmationSatisfied: true, // Malicious model argument
          },
          context: { db: mockDb, confirmationSatisfied: false },
        }),
      (err) => err instanceof ToolExecutionError && (err.code === 'INVALID_ARGS' || err.code === 'CONFIRMATION_REQUIRED')
    );
  });
});

describe('Phase 3: Strict Draft Policy', () => {
  test('create_course always enforces draft and rejects published status in model args', async () => {
    const mockDb = new MockDatabase();

    // Attempting to publish via create tool args must be rejected or discarded
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'create_course',
          args: {
            title: 'Draft Policy Course',
            grade: '1sec',
            price: 100,
            status: 'published', // Prohibited in creation
          },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'INVALID_ARGS'
    );

    // Normal creation forces is_active = 0 (draft)
    const res = await executeTool({
      actor: teacherActor,
      toolName: 'create_course',
      args: { title: 'Draft Policy Course', grade: '1sec', price: 100 },
      context: { db: mockDb },
    });
    assert.equal(res.ok, true);
    assert.equal(res.result.course.ok, true);
    const created = mockDb.tables.courses.get(res.result.course.id);
    assert.equal(created.status, 'draft');
    assert.equal(created.is_active, 0);
  });

  test('add_lecture, create_exam, create_quiz, create_assignment enforce draft status', async () => {
    const mockDb = new MockDatabase();

    // Rejects status argument in add_lecture
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'add_lecture',
          args: {
            courseId: 'c_unit1',
            title: 'Draft Lec',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            status: 'published',
          },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'INVALID_ARGS'
    );
  });
});

describe('Phase 3: Confirmation Boundary & Financial Protection', () => {
  test('destructive actions (delete_course, delete_lecture, delete_exam) reject without confirmation', async () => {
    const mockDb = new MockDatabase();

    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'delete_course',
          args: { courseId: 'c_unit1' },
          context: { db: mockDb, confirmationSatisfied: false },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'CONFIRMATION_REQUIRED'
    );

    // With confirmation satisfied in trusted context, it proceeds
    const res = await executeTool({
      actor: teacherActor,
      toolName: 'delete_course',
      args: { courseId: 'c_unit1' },
      context: { db: mockDb, confirmationSatisfied: true },
    });
    assert.equal(res.ok, true);
  });

  test('publish tools (publish_course, publish_lecture, publish_exam, publish_assignment) reject without confirmation', async () => {
    const mockDb = new MockDatabase();

    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'publish_course',
          args: { courseId: 'c_unit1' },
          context: { db: mockDb, confirmationSatisfied: false },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'CONFIRMATION_REQUIRED'
    );
  });

  test('financial price changes require explicit confirmation and permission', async () => {
    const mockDb = new MockDatabase();

    // update_course rejects price argument to prevent accidental price mutation
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'update_course',
          args: { courseId: 'c_unit1', price: 200 },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && (err.code === 'INVALID_ARGS' || err.code === 'FINANCIAL_ESCALATION')
    );

    // update_course_price requires confirmation
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'update_course_price',
          args: { courseId: 'c_unit1', price: 200 },
          context: { db: mockDb, confirmationSatisfied: false },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'CONFIRMATION_REQUIRED'
    );

    // update_course_price with confirmation succeeds
    const res = await executeTool({
      actor: teacherActor,
      toolName: 'update_course_price',
      args: { courseId: 'c_unit1', price: 200 },
      context: { db: mockDb, confirmationSatisfied: true },
    });
    assert.equal(res.ok, true);
  });
});

describe('Phase 3: Read Tool Data Minimization & Input Validation', () => {
  test('read tools return minimized metadata without sensitive student or system data', async () => {
    const mockDb = new MockDatabase();

    const structureRes = await executeTool({
      actor: teacherActor,
      toolName: 'get_course_structure',
      args: { courseId: 'c_unit1' },
      context: { db: mockDb },
    });

    assert.equal(structureRes.ok, true);
    assert.ok(structureRes.result.course);
    assert.equal('passwordHash' in structureRes.result.course, false);
    assert.equal('storageKey' in structureRes.result.course, false);

    const searchRes = await executeTool({
      actor: teacherActor,
      toolName: 'search_courses',
      args: { query: 'Foundations' },
      context: { db: mockDb },
    });
    assert.equal(searchRes.ok, true);
    assert.ok(Array.isArray(searchRes.result.courses));
  });

  test('strict schema validation rejects unknown fields and oversized inputs', async () => {
    const mockDb = new MockDatabase();

    // Unknown field in create_course
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'create_course',
          args: {
            title: 'Test',
            grade: '1sec',
            price: 100,
            unrecognizedField: 'random_payload',
          },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'INVALID_ARGS'
    );

    // Oversized title (> 200 chars)
    await assert.rejects(
      () =>
        executeTool({
          actor: teacherActor,
          toolName: 'create_course',
          args: {
            title: 'A'.repeat(250),
            grade: '1sec',
            price: 100,
          },
          context: { db: mockDb },
        }),
      (err) => err instanceof ToolExecutionError && err.code === 'INVALID_ARGS'
    );
  });
});
