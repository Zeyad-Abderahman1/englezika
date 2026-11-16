import assert from 'node:assert/strict';
import test from 'node:test';

test('assignment creation uploads the selected PDF only after receiving the new assignment id', async () => {
  const { createAssignmentWithOptionalPdf } = await import('../app/lib/assignment-creation.ts');
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'teacher.pdf', {
    type: 'application/pdf',
  });
  const calls = [];

  const result = await createAssignmentWithOptionalPdf(
    async (url, init) => {
      calls.push({ url, init });
      if (url === '/api/admin/assignments') return { ok: true, id: 'assignment-123' };
      return { ok: true };
    },
    { courseId: 'course-1', title: 'Homework' },
    pdf
  );

  assert.deepEqual(result, { id: 'assignment-123', fileUploaded: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/admin/assignments');
  assert.equal(calls[1].url, '/api/admin/assignments/assignment-123/file');
  assert.equal(calls[1].init.method, 'POST');
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(calls[1].init.body.get('file').name, 'teacher.pdf');
});

test('assignment creation supports no PDF and rejects invalid or oversized files before creation', async () => {
  const { createAssignmentWithOptionalPdf, MAX_ASSIGNMENT_PDF_SIZE } =
    await import('../app/lib/assignment-creation.ts');
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, id: 'assignment-plain' };
  };

  assert.deepEqual(await createAssignmentWithOptionalPdf(request, { title: 'No file' }, null), {
    id: 'assignment-plain',
    fileUploaded: false,
  });
  assert.equal(calls.length, 1);

  await assert.rejects(
    () =>
      createAssignmentWithOptionalPdf(
        request,
        { title: 'Invalid file' },
        new File(['not a pdf'], 'notes.txt', { type: 'text/plain' })
      ),
    /PDF/
  );
  await assert.rejects(
    () =>
      createAssignmentWithOptionalPdf(
        request,
        { title: 'Large file' },
        {
          name: 'large.pdf',
          type: 'application/pdf',
          size: MAX_ASSIGNMENT_PDF_SIZE + 1,
        }
      ),
    /15/
  );
  assert.equal(calls.length, 1, 'invalid files must be rejected before creating an assignment');
});

class StudentDeletionDatabase {
  constructor(staff) {
    this.staff = staff;
    this.student = {
      email: 'student@example.test',
      role: 'student',
      birthCertificateKey: 'birth-certificates/student/certificate.png',
    };
    this.sessionsRevoked = false;
    this.readsRemoved = false;
  }

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
        if (sql.includes('FROM staff_sessions')) return database.staff;
        if (sql.includes('SELECT birth_certificate_key')) {
          return database.student.role === 'student' && database.student.email === this.bindings[0]
            ? { birthCertificateKey: database.student.birthCertificateKey }
            : null;
        }
        return null;
      }
      async all() {
        return { results: [], success: true, meta: { changes: 0 } };
      }
      async run() {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('UPDATE users SET')) {
          const [tombstone, originalEmail, , email] = this.bindings;
          if (database.student.email !== email || database.student.role !== 'student') {
            return { success: true, meta: { changes: 0 } };
          }
          database.student.email = tombstone;
          database.student.originalEmail = originalEmail;
          database.student.role = 'deleted';
          database.student.birthCertificateKey = null;
          return { success: true, meta: { changes: 1 } };
        }
        if (normalized === 'DELETE FROM native_sessions WHERE email = ?') {
          database.sessionsRevoked = true;
        }
        if (normalized === 'DELETE FROM notification_reads WHERE user_email = ?') {
          database.readsRemoved = true;
        }
        return { success: true, meta: { changes: 0 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function staffRow(role, permissions) {
  return {
    expiresAt: Date.now() + 60_000,
    email: `${role}@example.test`,
    name: role,
    role,
    permissions: JSON.stringify(permissions),
  };
}

function deleteStudentRequest(headers = {}) {
  return new Request('https://example.test/api/admin/students', {
    method: 'DELETE',
    headers: { origin: 'https://example.test', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'Student@Example.test' }),
  });
}

test('student deletion requires manage_staff and reuses protected account cleanup', async () => {
  const { DELETE } = await import('../app/api/admin/students/route.ts');
  assert.equal(typeof DELETE, 'function');

  const teacherDb = new StudentDeletionDatabase(staffRow('teacher', []));
  const deletedKeys = [];
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: teacherDb,
    STORAGE: { delete: async (key) => deletedKeys.push(key) },
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };
  try {
    const authorized = await DELETE(
      deleteStudentRequest({ cookie: 'englizeka_staff=valid-staff-token' })
    );
    assert.equal(authorized.status, 200);
    assert.equal(teacherDb.student.role, 'deleted');
    assert.equal(teacherDb.student.originalEmail, 'student@example.test');
    assert.equal(teacherDb.sessionsRevoked, true);
    assert.equal(teacherDb.readsRemoved, true);
    assert.deepEqual(deletedKeys, ['birth-certificates/student/certificate.png']);

    const assistantDb = new StudentDeletionDatabase(staffRow('assistant', ['view_students']));
    globalThis.__ENGLIZEKA_ENV__.DB = assistantDb;
    const forbidden = await DELETE(
      deleteStudentRequest({ cookie: 'englizeka_staff=valid-staff-token' })
    );
    assert.equal(forbidden.status, 403);
    assert.equal(assistantDb.student.role, 'student');

    const studentOnly = await DELETE(
      deleteStudentRequest({ cookie: 'englizeka_session=student-session-token' })
    );
    assert.equal(studentOnly.status, 401);
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('only unread announcements actually rendered on home are selected as shown', async () => {
  const { visibleUnreadAnnouncementIds } = await import('../app/lib/announcement-display.ts');
  const announcements = [
    { id: 'a1', isRead: 0 },
    { id: 'a2', isRead: 1 },
    { id: 'a3', isRead: 0 },
    { id: 'a4', isRead: 0 },
    { id: 'a5', isRead: 0 },
  ];

  assert.deepEqual(visibleUnreadAnnouncementIds(announcements, true, 3), ['a1', 'a3']);
  assert.deepEqual(visibleUnreadAnnouncementIds(announcements, false, 3), []);
});

test('opening notifications does not bulk-mark announcements before rendering', async () => {
  const { openNotificationHome } = await import('../app/lib/announcement-display.ts');
  const navigation = [];
  const markedTypes = [];

  openNotificationHome(
    () => navigation.push('home'),
    (types) => markedTypes.push(...types)
  );

  assert.deepEqual(navigation, ['home']);
  assert.deepEqual(markedTypes, ['exam', 'assignment']);
  assert.equal(markedTypes.includes('announcement'), false);
});

class AnnouncementReadDatabase {
  currentEmail = 'first@example.test';
  published = new Set(['a1', 'a2']);
  reads = new Set();

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
        if (sql.includes('FROM native_sessions')) {
          return { email: database.currentEmail, name: 'Student', emailVerified: 1 };
        }
        return null;
      }
      async run() {
        if (!sql.includes('INSERT INTO notification_reads')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.includes('AND id = ?')) {
          const [email, , id] = this.bindings;
          if (database.published.has(id)) database.reads.add(`${email}:${id}`);
        } else {
          const [email] = this.bindings;
          for (const id of database.published) database.reads.add(`${email}:${id}`);
        }
        return { success: true, meta: { changes: 1 } };
      }
    })();
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

test('announcement shown state records only supplied published ids for the authenticated student', async () => {
  const db = new AnnouncementReadDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: { delete: async () => {} },
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };
  try {
    const { POST } = await import('../app/api/notifications/read/route.ts');
    const response = await POST(
      new Request('https://example.test/api/notifications/read', {
        method: 'POST',
        headers: {
          origin: 'https://example.test',
          cookie: 'englizeka_student=student-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ announcementIds: ['a1', 'missing'] }),
      })
    );
    assert.equal(response.status, 200);
    assert.deepEqual([...db.reads], ['first@example.test:a1']);
    assert.equal(db.reads.has('second@example.test:a1'), false);
    assert.equal(db.reads.has('first@example.test:a2'), false);
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});
