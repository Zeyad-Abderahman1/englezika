import assert from 'node:assert/strict';
import test from 'node:test';

class MockStorage {
  files = new Map();
  async delete(key) {
    this.files.delete(key);
  }
}

class MockAssignmentDatabase {
  assignments = new Map();
  submissions = new Map();
  questions = new Map();
  notifications = new Map();

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const database = this;
    return new (class {
      bindings = [];
      bind(...bindings) {
        this.bindings = bindings;
        return this;
      }
      async first() {
        const id = this.bindings[0];
        if (sql.includes('FROM staff_sessions')) {
          return {
            expiresAt: Date.now() + 60000,
            email: 'teacher@example.test',
            name: 'Teacher',
            role: 'teacher',
            permissions: '["manage_assignments"]',
          };
        }
        if (sql.includes('FROM assignments WHERE id = ?')) {
          return database.assignments.get(id) || null;
        }
        return null;
      }
      async all() {
        const id = this.bindings[0];
        if (sql.includes('FROM assignment_submissions WHERE assignment_id = ?')) {
          const results = Array.from(database.submissions.values()).filter((s) => s.assignment_id === id);
          return { results, success: true, meta: { changes: results.length } };
        }
        return { results: [], success: true, meta: { changes: 0 } };
      }
      async run() {
        const id = this.bindings[0];
        if (sql.includes('DELETE FROM assignments WHERE id = ?')) {
          database.assignments.delete(id);
        } else if (sql.includes('DELETE FROM assignment_submissions WHERE assignment_id = ?')) {
          for (const [key, sub] of database.submissions.entries()) {
            if (sub.assignment_id === id) database.submissions.delete(key);
          }
        } else if (sql.includes('DELETE FROM assignment_questions WHERE assignment_id = ?')) {
          for (const [key, q] of database.questions.entries()) {
            if (q.assignment_id === id) database.questions.delete(key);
          }
        }
        return { success: true, meta: { changes: 1 } };
      }
    })();
  }

  async batch(statements) {
    return Promise.all(statements.map((s) => s.run()));
  }
}

test('assignment deletion removes teacher PDF, student submission PDFs, and child records', async () => {
  const db = new MockAssignmentDatabase();
  const storage = new MockStorage();

  const assignmentId = 'assign-123';
  const teacherPdfKey = `assignments/${assignmentId}/teacher.pdf`;
  const studentPdfKey = `assignments/${assignmentId}/submissions/hash-sub-1.pdf`;

  db.assignments.set(assignmentId, { id: assignmentId, teacherFileKey: teacherPdfKey });
  db.submissions.set('sub-1', { id: 'sub-1', assignment_id: assignmentId, pdfStorageKey: studentPdfKey });
  db.questions.set('q-1', { id: 'q-1', assignment_id: assignmentId });

  storage.files.set(teacherPdfKey, 'teacher-pdf-content');
  storage.files.set(studentPdfKey, 'student-pdf-content');

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: storage,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };

  const { DELETE } = await import('../app/api/admin/assignments/[id]/route.ts');
  const req = new Request(`https://example.test/api/admin/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: {
      origin: 'https://example.test',
      cookie: 'englizeka_staff=valid-staff-token',
    },
  });

  try {
    const res = await DELETE(req, { params: Promise.resolve({ id: assignmentId }) });
    assert.equal(res.status, 204);

    assert.equal(storage.files.has(teacherPdfKey), false, 'Teacher PDF should be deleted');
    assert.equal(storage.files.has(studentPdfKey), false, 'Student submission PDF should be deleted');

    assert.equal(db.assignments.has(assignmentId), false, 'Assignment row should be deleted');
    assert.equal(db.submissions.size, 0, 'Assignment submissions should be deleted');
    assert.equal(db.questions.size, 0, 'Assignment questions should be deleted');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});
