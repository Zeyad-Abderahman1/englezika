import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const headersMod = require('next/headers.js');

let activeStudentCookie = null;
headersMod.cookies = async () => ({
  get(name) {
    if (activeStudentCookie && name === 'englizeka_student') {
      return { name, value: activeStudentCookie };
    }
    return undefined;
  },
});

class MockStorage {
  files = new Map();

  async put(key, bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.files.set(key, data);
    return { key, size: data.byteLength };
  }

  async get(key) {
    const data = this.files.get(key);
    if (!data) return null;
    return {
      body: data,
      size: data.byteLength,
      text: async () => new TextDecoder().decode(data),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  }

  async delete(key) {
    this.files.delete(key);
  }
}

class MockMaterialDatabase {
  videos = new Map();
  materials = new Map();
  activeStaff = null;
  activeStudent = null;
  enrollments = new Map();

  prepare(sql) {
    const self = this;
    const normalized = sql.replace(/\s+/g, ' ').trim();

    return new (class {
      bindings = [];

      bind(...args) {
        this.bindings = args;
        return this;
      }

      async first() {
        // Staff authentication
        if (normalized.includes('FROM staff_sessions s JOIN staff_users')) {
          if (!self.activeStaff) return null;
          return {
            expiresAt: Date.now() + 60_000,
            email: self.activeStaff.email,
            name: self.activeStaff.name,
            role: self.activeStaff.role,
            permissions: JSON.stringify(self.activeStaff.permissions),
          };
        }

        // Student authentication
        if (normalized.includes('FROM native_sessions s JOIN users u')) {
          if (!self.activeStudent) return null;
          return {
            email: self.activeStudent.email,
            name: self.activeStudent.name,
            emailVerified: 1,
          };
        }

        // Video existence check
        if (normalized.startsWith('SELECT id, course_id AS courseId FROM videos WHERE id = ?')) {
          const videoId = this.bindings[0];
          const video = self.videos.get(videoId);
          if (!video) return null;
          return { id: video.id, courseId: video.courseId };
        }

        // Enrollment check
        if (normalized.includes('FROM enrollments WHERE')) {
          const email = this.bindings[0];
          const courseId = this.bindings[1];
          const key = `${email}:${courseId}`;
          if (self.enrollments.get(key) === 'approved') {
            return { exists: 1 };
          }
          return null;
        }

        // Single material lookup by ID and video_id
        if (
          normalized.startsWith(
            'SELECT id, file_key AS storageKey FROM lecture_materials WHERE id = ? AND video_id = ?'
          )
        ) {
          const [matId, vidId] = this.bindings;
          const m = self.materials.get(matId);
          if (!m || m.video_id !== vidId) return null;
          return { id: m.id, storageKey: m.file_key };
        }

        return null;
      }

      async all() {
        // List materials for video in admin
        if (
          normalized.startsWith(
            'SELECT id, file_key AS storageKey, title AS fileName, file_size AS fileSize, created_at AS createdAt FROM lecture_materials WHERE video_id = ? ORDER BY created_at'
          )
        ) {
          const videoId = this.bindings[0];
          const list = Array.from(self.materials.values())
            .filter((m) => m.video_id === videoId)
            .sort((a, b) => a.created_at - b.created_at)
            .map((m) => ({
              id: m.id,
              storageKey: m.file_key,
              fileName: m.title,
              fileSize: m.file_size,
              createdAt: m.created_at,
            }));
          return { results: list };
        }

        // List materials for student
        if (
          normalized.startsWith(
            'SELECT id, file_key AS storageKey, title AS fileName, file_size AS fileSize FROM lecture_materials WHERE video_id = ? ORDER BY created_at'
          )
        ) {
          const videoId = this.bindings[0];
          const list = Array.from(self.materials.values())
            .filter((m) => m.video_id === videoId)
            .sort((a, b) => a.created_at - b.created_at)
            .map((m) => ({
              id: m.id,
              storageKey: m.file_key,
              fileName: m.title,
              fileSize: m.file_size,
            }));
          return { results: list };
        }

        // Admin delete all materials for video
        if (
          normalized.startsWith(
            'SELECT id, file_key AS storageKey FROM lecture_materials WHERE video_id = ?'
          )
        ) {
          const videoId = this.bindings[0];
          const list = Array.from(self.materials.values())
            .filter((m) => m.video_id === videoId)
            .map((m) => ({ id: m.id, storageKey: m.file_key }));
          return { results: list };
        }

        // Course sequence items
        if (normalized.includes('FROM course_items WHERE course_id = ?')) {
          return { results: [] };
        }

        return { results: [] };
      }

      async run() {
        // Insert material
        if (
          normalized.startsWith(
            'INSERT INTO lecture_materials (id, video_id, title, file_key, mime_type, file_size, created_at)'
          )
        ) {
          const [id, video_id, title, file_key, mime_type, file_size, created_at] = this.bindings;
          self.materials.set(id, { id, video_id, title, file_key, mime_type, file_size, created_at });
          return { success: true, meta: { changes: 1 } };
        }

        // Delete material by id
        if (normalized.startsWith('DELETE FROM lecture_materials WHERE id = ?')) {
          const id = this.bindings[0];
          self.materials.delete(id);
          return { success: true, meta: { changes: 1 } };
        }

        // Delete all materials for video
        if (normalized.startsWith('DELETE FROM lecture_materials WHERE video_id = ?')) {
          const videoId = this.bindings[0];
          for (const [key, val] of self.materials.entries()) {
            if (val.video_id === videoId) self.materials.delete(key);
          }
          return { success: true, meta: { changes: 1 } };
        }

        return { success: true, meta: { changes: 0 } };
      }
    })();
  }
}

function createValidPdfBlob(text = 'Hello World PDF') {
  const content = `%PDF-1.4\n1 0 obj\n<< /Title (${text}) >>\nendobj\ntrailer\n<<>>\n%%EOF`;
  return new Blob([content], { type: 'application/pdf' });
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
  delete globalThis.__ENGLIZEKA_PRIVATE_STORAGE__;
  activeStudentCookie = null;
});

test('CASE 1 — Authorized staff + valid small PDF: upload succeeds, DB row created with schema columns, file written to private storage', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  db.activeStaff = {
    email: 'teacher@englizeka.com',
    name: 'Teacher',
    role: 'teacher',
    permissions: ['manage_videos'],
  };

  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST, GET, DELETE } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  const pdfBlob = createValidPdfBlob('Test Lecture Notes');
  const formData = new FormData();
  formData.append('files', new File([pdfBlob], 'Lecture01.pdf', { type: 'application/pdf' }));

  const postReq = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': String(pdfBlob.size + 500),
    },
    body: formData,
  });

  const postRes = await POST(postReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(postRes.status, 200);
  const postBody = await postRes.json();
  assert.equal(postBody.ok, true);
  assert.equal(postBody.materials.length, 1);
  const created = postBody.materials[0];
  assert.equal(created.fileName, 'Lecture01');

  // Verify DB record matches schema columns exactly
  const dbRow = db.materials.get(created.id);
  assert.ok(dbRow, 'DB row must exist');
  assert.equal(dbRow.video_id, 'vid-101');
  assert.equal(dbRow.title, 'Lecture01');
  assert.equal(dbRow.mime_type, 'application/pdf');
  assert.equal(dbRow.file_key, `videos/vid-101/materials/${created.id}.pdf`);
  assert.equal(dbRow.file_size, pdfBlob.size);
  assert.equal(typeof dbRow.created_at, 'number');

  // Verify private storage file
  const storedFile = await storage.get(dbRow.file_key);
  assert.ok(storedFile, 'File must be written to private storage');
  assert.equal(storedFile.size, pdfBlob.size);

  // Verify GET /api/admin/videos/[id]/materials
  const getReq = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    headers: {
      cookie: 'englizeka_staff=valid-staff-token-12345678',
    },
  });
  const getRes = await GET(getReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.materials.length, 1);
  assert.equal(getBody.materials[0].fileName, 'Lecture01');
  assert.equal(getBody.materials[0].storageKey, dbRow.file_key);

  // Verify DELETE /api/admin/videos/[id]/materials?id=xxx
  const delReq = new Request(`https://englezika.com/api/admin/videos/vid-101/materials?id=${created.id}`, {
    method: 'DELETE',
    headers: {
      cookie: 'englizeka_staff=valid-staff-token-12345678',
    },
  });
  const delRes = await DELETE(delReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(delRes.status, 200);
  assert.equal(db.materials.has(created.id), false, 'Material must be deleted from DB');
  assert.equal(await storage.get(dbRow.file_key), null, 'Material file must be removed from storage');
});

test('CASE 2 — Unauthorized staff: unauthenticated or lacking manage_videos permission is rejected', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  // Subcase A: Unauthenticated (no cookie)
  db.activeStaff = null;
  const pdfBlob = createValidPdfBlob();
  const formData = new FormData();
  formData.append('files', new File([pdfBlob], 'Test.pdf', { type: 'application/pdf' }));

  const unauthReq = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: { origin: 'https://englezika.com' },
    body: formData,
  });
  const unauthRes = await POST(unauthReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(unauthRes.status, 401);

  // Subcase B: Authenticated assistant without manage_videos permission
  db.activeStaff = {
    email: 'assistant@englizeka.com',
    name: 'Assistant',
    role: 'assistant',
    permissions: ['view_students'], // no manage_videos
  };

  const noPermsReq = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=assistant-token-12345678',
    },
    body: formData,
  });
  const noPermsRes = await POST(noPermsReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(noPermsRes.status, 403);
});

test('CASE 3 — Invalid/malformed file: missing PDF magic bytes or non-PDF mime is rejected', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  db.activeStaff = {
    email: 'teacher@englizeka.com',
    name: 'Teacher',
    role: 'teacher',
    permissions: ['manage_videos'],
  };
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  // Corrupt file that claims to be PDF but lacks %PDF- header
  const fakePdfBlob = new Blob(['THIS IS NOT A VALID PDF FILE'], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('files', new File([fakePdfBlob], 'Fake.pdf', { type: 'application/pdf' }));

  const req = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': '1024',
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /يجب أن يكون PDF صالح/);
  assert.equal(db.materials.size, 0);
  assert.equal(storage.files.size, 0);
});

test('CASE 4 — Wrong/nonexistent video ID: returns 404', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.activeStaff = {
    email: 'teacher@englizeka.com',
    name: 'Teacher',
    role: 'teacher',
    permissions: ['manage_videos'],
  };
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  const pdfBlob = createValidPdfBlob();
  const formData = new FormData();
  formData.append('files', new File([pdfBlob], 'Lecture.pdf', { type: 'application/pdf' }));

  const req = new Request('https://englezika.com/api/admin/videos/nonexistent-vid/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': '1024',
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'nonexistent-vid' }) });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error, /المحاضرة غير موجودة/);
});

test('CASE 5 — Student material route: enrolled student can fetch and download material; unenrolled rejected with 403', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();

  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  db.materials.set('mat-1', {
    id: 'mat-1',
    video_id: 'vid-101',
    title: 'Worksheet 1',
    file_key: 'videos/vid-101/materials/mat-1.pdf',
    mime_type: 'application/pdf',
    file_size: 1024,
    created_at: 1000,
  });
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 Worksheet Content');
  storage.files.set('videos/vid-101/materials/mat-1.pdf', pdfBytes);

  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };
  globalThis.__ENGLIZEKA_PRIVATE_STORAGE__ = storage;
  activeStudentCookie = 'student-session-token-12345678';

  const { GET: studentGet } = await import('../app/api/student/videos/[id]/materials/route.ts');

  // Subcase A: Unenrolled student
  db.activeStudent = { email: 'student@example.test', name: 'Student 1' };

  const unenrolledReq = new Request('https://englezika.com/api/student/videos/vid-101/materials', {
    headers: {
      cookie: 'englizeka_student=student-session-token-12345678',
    },
  });
  const unenrolledRes = await studentGet(unenrolledReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(unenrolledRes.status, 403);

  // Subcase B: Enrolled student list materials
  db.enrollments.set('student@example.test:crs-1', 'approved');

  const listReq = new Request('https://englezika.com/api/student/videos/vid-101/materials', {
    headers: {
      cookie: 'englizeka_student=student-session-token-12345678',
    },
  });
  const listRes = await studentGet(listReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.materials.length, 1);
  assert.equal(listBody.materials[0].fileName, 'Worksheet 1');

  // Subcase C: Enrolled student download file
  const dlReq = new Request('https://englezika.com/api/student/videos/vid-101/materials?download=mat-1', {
    headers: {
      cookie: 'englizeka_student=student-session-token-12345678',
    },
  });
  const dlRes = await studentGet(dlReq, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get('Content-Type'), 'application/pdf');
  assert.match(dlRes.headers.get('Content-Disposition'), /inline; filename="Worksheet%201\.pdf"/);
});

test('CASE 6 — Filename / path traversal attempts: sanitized safely, storage key remains bounded under UUID.pdf', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  db.activeStaff = {
    email: 'teacher@englizeka.com',
    name: 'Teacher',
    role: 'teacher',
    permissions: ['manage_videos'],
  };
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  const pdfBlob = createValidPdfBlob('Payload');
  const formData = new FormData();
  formData.append(
    'files',
    new File([pdfBlob], '../../../etc/passwd\r\n.pdf', { type: 'application/pdf' })
  );

  const req = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': '1024',
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const matId = body.materials[0].id;
  const dbRow = db.materials.get(matId);

  // Storage key MUST be strictly under videos/vid-101/materials/{uuid}.pdf
  assert.equal(dbRow.file_key, `videos/vid-101/materials/${matId}.pdf`);
  assert.equal(storage.files.has(`videos/vid-101/materials/${matId}.pdf`), true);
  // Title must NOT contain newlines or control characters
  assert.ok(!dbRow.title.includes('\r'));
  assert.ok(!dbRow.title.includes('\n'));
});

test('CASE 7 — Oversized payload rejection: returns 413 when content-length exceeds MAX_MATERIAL_UPLOAD_BODY_SIZE', async () => {
  const db = new MockMaterialDatabase();
  const storage = new MockStorage();
  db.videos.set('vid-101', { id: 'vid-101', courseId: 'crs-1' });
  db.activeStaff = {
    email: 'teacher@englizeka.com',
    name: 'Teacher',
    role: 'teacher',
    permissions: ['manage_videos'],
  };
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: storage };

  const { POST } = await import('../app/api/admin/videos/[id]/materials/route.ts');

  const pdfBlob = createValidPdfBlob();
  const formData = new FormData();
  formData.append('files', new File([pdfBlob], 'Large.pdf', { type: 'application/pdf' }));

  const req = new Request('https://englezika.com/api/admin/videos/vid-101/materials', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      cookie: 'englizeka_staff=valid-staff-token-12345678',
      'content-length': String(30 * 1024 * 1024), // 30 MB > 25.5 MB
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'vid-101' }) });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /يتجاوز الحد المسموح/);
});
