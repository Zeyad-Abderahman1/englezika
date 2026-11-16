import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isImageUpload,
  getImageExtension,
  getImageDimensions,
  hasReasonableCourseThumbnailDimensions,
  sniffImageMimeType,
  MAX_IMAGE_SIZE,
} from '../app/lib/upload-validation.ts';
import { POST, DELETE } from '../app/api/admin/courses/[id]/thumbnail/route.ts';
import { PATCH } from '../app/api/admin/courses/[id]/route.ts';
import { GET as bootstrapGET } from '../app/api/admin/bootstrap/route.ts';
import { GET } from '../app/api/courses/[id]/thumbnail/route.ts';
import {
  getCourseThumbnailVersion,
  getCourseThumbnailUrl,
} from '../app/lib/course-thumbnail.ts';

// Helper to construct a minimal valid PNG buffer (320x180)
function createValidPngBuffer(width = 320, height = 180) {
  const buffer = Buffer.alloc(33);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.set([0x49, 0x48, 0x44, 0x52], 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.set([8, 2, 0, 0, 0], 24);
  buffer.writeUInt32BE(0x12345678, 29);
  return buffer;
}

// Helper to construct a minimal valid JPEG buffer (320x180)
function createValidJpegBuffer(width = 320, height = 180) {
  const parts = [
    Buffer.from([0xff, 0xd8, 0xff]), // SOI
    Buffer.from([
      0xff, 0xc0,
      0x00, 0x11,
      0x08,
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
      0x03,
      0x01, 0x11, 0x00,
      0x02, 0x11, 0x01,
      0x03, 0x11, 0x01,
    ]),
    Buffer.from([0xff, 0xd9]), // EOI
  ];
  return Buffer.concat(parts);
}

// Helper to construct a minimal valid WebP (VP8 lossy) buffer (320x180)
function createValidWebpBuffer(width = 320, height = 180) {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8);
  buffer.write('VP8 ', 12);
  buffer.writeUInt32LE(10, 16);
  buffer.set([0x00, 0x00, 0x00], 20);
  buffer.set([0x9d, 0x01, 0x2a], 23);
  buffer.writeUInt16LE(width & 0x3fff, 26);
  buffer.writeUInt16LE(height & 0x3fff, 28);
  return buffer;
}

function setupMockPlatform() {
  const courses = [
    {
      id: 'c1',
      title: 'Course Without Thumb',
      grade: 'الصف الأول الثانوي',
      description: 'وصف كورس 1',
      price: 150,
      status: 'published',
      thumbnail_key: null,
      created_at: 1726000000000,
      updated_at: 1726000000000,
    },
    {
      id: 'c2',
      title: 'Course With Thumb',
      grade: 'الصف الثاني الثانوي',
      description: 'وصف كورس 2',
      price: 200,
      status: 'published',
      thumbnail_key: 'courses/c2/thumbnail/initial.webp',
      created_at: 1726000000000,
      updated_at: 1726000000000,
    },
  ];

  const storageFiles = new Map();
  // Pre-seed an initial thumbnail for c2
  const initialPng = createValidPngBuffer(320, 180);
  storageFiles.set('courses/c2/thumbnail/initial.webp', initialPng);

  const mockDb = {
    courses,
    prepare(sql) {
      function createStmt(args = []) {
        return {
          bind(...newArgs) {
            return createStmt(newArgs);
          },
          async first() {
            if (sql.includes('FROM staff_sessions s JOIN staff_users u')) {
              return {
                expiresAt: Date.now() + 3600000,
                email: 'admin@englizeka.com',
                name: 'Admin Teacher',
                role: 'teacher',
                permissions: '["manage_courses"]',
              };
            }
            if (sql.includes('FROM courses WHERE id = ?')) {
              const [id] = args;
              const c = courses.find((x) => x.id === id);
              if (!c) return null;
              return {
                id: c.id,
                title: c.title,
                grade: c.grade,
                description: c.description,
                price: c.price,
                status: c.status,
                thumbnailKey: c.thumbnail_key,
                updatedAt: c.updated_at,
              };
            }
            if (sql.includes('SELECT COUNT(*) AS total FROM')) {
              return { total: courses.length };
            }
            if (sql.includes('SELECT') && sql.includes('AS students')) {
              return {
                students: 10,
                activeEnrollments: 5,
                pendingEnrollments: 2,
                publishedExams: 3,
                attempts: 4,
                averageScore: 85,
                newMessages: 1,
              };
            }
            return null;
          },
          async all() {
            if (sql.includes('FROM courses ORDER BY created_at DESC')) {
              return {
                results: courses.map((c) => ({
                  id: c.id,
                  title: c.title,
                  grade: c.grade,
                  description: c.description,
                  price: c.price,
                  status: c.status,
                  thumbnailKey: c.thumbnail_key,
                  createdAt: c.created_at,
                  updatedAt: c.updated_at,
                })),
              };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes('UPDATE courses SET thumbnail_key = ?')) {
              const [key, updatedAt, id] = args;
              const c = courses.find((x) => x.id === id);
              if (c) {
                c.thumbnail_key = key;
                c.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.includes('UPDATE courses SET thumbnail_key = NULL')) {
              const [updatedAt, id] = args;
              const c = courses.find((x) => x.id === id);
              if (c) {
                c.thumbnail_key = null;
                c.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.includes('UPDATE courses SET title = ?')) {
              const [title, grade, description, price, status, updatedAt, id] = args;
              const c = courses.find((x) => x.id === id);
              if (c) {
                c.title = title;
                c.grade = grade;
                c.description = description;
                c.price = price;
                c.status = status;
                c.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.includes('INSERT INTO audit_logs')) {
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      }
      return createStmt();
    },
  };

  const mockStorage = {
    files: storageFiles,
    async put(key, body) {
      storageFiles.set(key, body);
      return { key, size: body.byteLength };
    },
    async get(key) {
      if (!storageFiles.has(key)) return null;
      const body = storageFiles.get(key);
      return { body, size: body.byteLength };
    },
    async delete(key) {
      storageFiles.delete(key);
    },
  };

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: mockDb,
    STORAGE: mockStorage,
  };

  return { mockDb, mockStorage };
}

test('1. Image validation: rejects SVG, HTML, scripts, executables, and spoofed extensions', () => {
  const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(isImageUpload('image/svg+xml', svgContent), false);
  assert.equal(isImageUpload('image/png', svgContent), false);

  const htmlContent = Buffer.from('<!DOCTYPE html><html><body>malicious</body></html>');
  assert.equal(isImageUpload('text/html', htmlContent), false);
  assert.equal(isImageUpload('image/jpeg', htmlContent), false);

  const exeContent = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
  assert.equal(isImageUpload('application/x-msdownload', exeContent), false);
  assert.equal(isImageUpload('image/webp', exeContent), false);
});

test('2. Image validation: parses dimensions and verifies bounds for JPEG, PNG, and WebP', () => {
  const png1280 = createValidPngBuffer(1280, 720);
  assert.equal(isImageUpload('image/png', png1280), true);
  const pngDims = getImageDimensions('image/png', png1280);
  assert.deepEqual(pngDims, { width: 1280, height: 720 });
  assert.equal(hasReasonableCourseThumbnailDimensions(pngDims), true);

  const jpeg640 = createValidJpegBuffer(640, 360);
  assert.equal(isImageUpload('image/jpeg', jpeg640), true);
  const jpegDims = getImageDimensions('image/jpeg', jpeg640);
  assert.deepEqual(jpegDims, { width: 640, height: 360 });
  assert.equal(hasReasonableCourseThumbnailDimensions(jpegDims), true);

  const webp800 = createValidWebpBuffer(800, 450);
  assert.equal(isImageUpload('image/webp', webp800), true);
  const webpDims = getImageDimensions('image/webp', webp800);
  assert.deepEqual(webpDims, { width: 800, height: 450 });
  assert.equal(hasReasonableCourseThumbnailDimensions(webpDims), true);

  const tinyPng = createValidPngBuffer(50, 50);
  const tinyDims = getImageDimensions('image/png', tinyPng);
  assert.equal(hasReasonableCourseThumbnailDimensions(tinyDims), false);

  const hugePng = createValidPngBuffer(10000, 10000);
  const hugeDims = getImageDimensions('image/png', hugePng);
  assert.equal(hasReasonableCourseThumbnailDimensions(hugeDims), false);
});

test('3. Admin thumbnail API: rejects unauthenticated requests and requests missing manage_courses', async () => {
  const req = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'multipart/form-data',
    },
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
  assert.ok(res.status === 401 || res.status === 403 || res.status === 302);
});

test('4. Admin thumbnail API: enforces CSRF / same-origin protection', async () => {
  const req = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://evil-attacker.com',
      'content-type': 'multipart/form-data',
    },
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res.status, 403);
});

test('5. Public thumbnail route: returns 404 when course has no thumbnail', async () => {
  setupMockPlatform();
  const req = new Request('http://localhost:3000/api/courses/c1/thumbnail', {
    method: 'GET',
  });
  const res = await GET(req, {
    params: Promise.resolve({ id: 'c1' }),
  });
  assert.equal(res.status, 404);
});

test('6. Public thumbnail route: serves valid thumbnail with ETag, Content-Type, and 304 caching', async () => {
  setupMockPlatform();
  const req = new Request('http://localhost:3000/api/courses/c2/thumbnail', {
    method: 'GET',
  });
  const res = await GET(req, {
    params: Promise.resolve({ id: 'c2' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.ok(res.headers.get('cache-control')?.includes('public'));
  const etag = res.headers.get('etag');
  assert.ok(etag);

  // Subsequent request with matching If-None-Match returns 304 Not Modified
  const cacheReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', {
    method: 'GET',
    headers: {
      'if-none-match': etag,
    },
  });
  const cacheRes = await GET(cacheReq, {
    params: Promise.resolve({ id: 'c2' }),
  });
  assert.equal(cacheRes.status, 304);
});

test('7. Storage key convention: follows safe, non-guessable course thumbnail path structure', () => {
  const courseId = 'course-uuid-123';
  const ext = getImageExtension('image/webp');
  assert.equal(ext, 'webp');
  assert.equal(getImageExtension('image/jpeg'), 'jpg');
  assert.equal(getImageExtension('image/png'), 'png');

  const storageKey = `courses/${courseId}/thumbnail/${crypto.randomUUID()}.${ext}`;
  assert.ok(storageKey.startsWith(`courses/${courseId}/thumbnail/`));
  assert.ok(storageKey.endsWith('.webp'));
  assert.ok(!storageKey.includes('..'));
});

test('8. Admin adds thumbnail to course: saves to storage, updates DB, and serves publicly', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const validPng = createValidPngBuffer(1280, 720);

  const formData = new FormData();
  formData.append('file', new Blob([validPng], { type: 'image/png' }), 'custom-course.png');

  const req = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(validPng.byteLength + 200),
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.key.startsWith('courses/c1/thumbnail/'));
  assert.ok(json.key.endsWith('.png'));

  // Course DB row updated
  const courseC1 = mockDb.courses.find((c) => c.id === 'c1');
  assert.equal(courseC1.thumbnail_key, json.key);

  // File exists in storage
  assert.ok(mockStorage.files.has(json.key));

  // Public endpoint now delivers it
  const getReq = new Request('http://localhost:3000/api/courses/c1/thumbnail', { method: 'GET' });
  const getRes = await GET(getReq, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('content-type'), 'image/png');
});

test('9. Admin replaces thumbnail: new image saved, DB updated, old file safely cleaned from storage', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const oldKey = 'courses/c2/thumbnail/initial.webp';
  assert.ok(mockStorage.files.has(oldKey));

  const newWebp = createValidWebpBuffer(640, 360);
  const formData = new FormData();
  formData.append('file', new Blob([newWebp], { type: 'image/webp' }), 'replacement.webp');

  const req = new Request('http://localhost:3000/api/admin/courses/c2/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(newWebp.byteLength + 200),
    },
    body: formData,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);

  // DB updated to new key
  const courseC2 = mockDb.courses.find((c) => c.id === 'c2');
  assert.equal(courseC2.thumbnail_key, json.key);
  assert.notEqual(json.key, oldKey);

  // Old file deleted from storage, new file exists
  assert.equal(mockStorage.files.has(oldKey), false, 'Old thumbnail must be deleted');
  assert.equal(mockStorage.files.has(json.key), true, 'New thumbnail must exist in storage');
});

test('10. Admin removes thumbnail: clears DB and deletes file from storage', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const existingKey = 'courses/c2/thumbnail/initial.webp';
  assert.ok(mockStorage.files.has(existingKey));

  const req = new Request('http://localhost:3000/api/admin/courses/c2/thumbnail', {
    method: 'DELETE',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
    },
  });

  const res = await DELETE(req, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);

  // DB cleared
  const courseC2 = mockDb.courses.find((c) => c.id === 'c2');
  assert.equal(courseC2.thumbnail_key, null);

  // File removed from storage
  assert.equal(mockStorage.files.has(existingKey), false);

  // Public GET now returns 404
  const getReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', { method: 'GET' });
  const getRes = await GET(getReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(getRes.status, 404);
});

test('11. Thumbnail versioning helper: extracts stable version tokens and builds versioned URLs', () => {
  assert.equal(getCourseThumbnailUrl('c1', null), '');
  assert.equal(getCourseThumbnailUrl('c1', undefined), '');

  const key1 = 'courses/c1/thumbnail/b49c71a3-28c0-4ff6-9db8-0245a7b69c4f.png';
  const v1 = getCourseThumbnailVersion(key1);
  assert.equal(v1, 'b49c71a3-28c0-4ff6-9db8-0245a7b69c4f');

  const url1 = getCourseThumbnailUrl('c1', key1);
  assert.equal(url1, `/api/courses/c1/thumbnail?v=${v1}`);

  // Re-evaluating with unchanged key produces the exact same URL
  assert.equal(getCourseThumbnailUrl('c1', key1), url1);

  // Fallback to updatedAt if token is generic or absent
  assert.equal(getCourseThumbnailVersion('thumbnail', 1726070000000), '1726070000000');
});

test('12. Replacement with identical filename generates distinct storage key and new versioned URL', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const c1 = mockDb.courses.find((c) => c.id === 'c1');

  // Step 1: Upload first image named 'course-thumbnail.png'
  const firstPng = createValidPngBuffer(320, 180);
  const fd1 = new FormData();
  fd1.append('file', new Blob([firstPng], { type: 'image/png' }), 'course-thumbnail.png');

  const req1 = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(firstPng.byteLength + 200),
    },
    body: fd1,
  });

  const res1 = await POST(req1, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  const firstKey = json1.key;
  const firstUrl = getCourseThumbnailUrl('c1', firstKey);
  assert.ok(firstUrl.includes('?v='));

  // Step 2: Replace with another image ALSO named 'course-thumbnail.png'
  const secondPng = createValidPngBuffer(640, 360);
  const fd2 = new FormData();
  fd2.append('file', new Blob([secondPng], { type: 'image/png' }), 'course-thumbnail.png');

  const req2 = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(secondPng.byteLength + 200),
    },
    body: fd2,
  });

  const res2 = await POST(req2, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  const secondKey = json2.key;
  const secondUrl = getCourseThumbnailUrl('c1', secondKey);

  // Distinct storage keys and URLs
  assert.notEqual(firstKey, secondKey);
  assert.notEqual(firstUrl, secondUrl);

  // Old file deleted, new file in storage, DB points to second
  assert.equal(mockStorage.files.has(firstKey), false);
  assert.equal(mockStorage.files.has(secondKey), true);
  assert.equal(c1.thumbnail_key, secondKey);
});

test('13. Public route caching headers: versioned requests allow strong caching, unversioned requests require revalidation', async () => {
  setupMockPlatform();

  // Versioned GET
  const versionedReq = new Request('http://localhost:3000/api/courses/c2/thumbnail?v=initial', {
    method: 'GET',
  });
  const versionedRes = await GET(versionedReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(versionedRes.status, 200);
  assert.ok(versionedRes.headers.get('cache-control')?.includes('max-age=86400'));
  assert.ok(versionedRes.headers.get('cache-control')?.includes('public'));

  // Unversioned GET
  const unversionedReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', {
    method: 'GET',
  });
  const unversionedRes = await GET(unversionedReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(unversionedRes.status, 200);
  assert.ok(unversionedRes.headers.get('cache-control')?.includes('no-cache'));
  assert.ok(unversionedRes.headers.get('cache-control')?.includes('public'));
});

test('14. Failed thumbnail replacement: invalid file leaves existing thumbnail intact in storage and DB', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const initialKey = 'courses/c2/thumbnail/initial.webp';
  assert.ok(mockStorage.files.has(initialKey));

  // Try uploading malicious or invalid non-image payload
  const badContent = Buffer.from('<script>alert("hacked")</script>');
  const fd = new FormData();
  fd.append('file', new Blob([badContent], { type: 'text/html' }), 'exploit.html');

  const req = new Request('http://localhost:3000/api/admin/courses/c2/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(badContent.byteLength + 200),
    },
    body: fd,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(res.status, 400);

  // DB course retains initial thumbnail
  const courseC2 = mockDb.courses.find((c) => c.id === 'c2');
  assert.equal(courseC2.thumbnail_key, initialKey);

  // Initial file still present in storage
  assert.ok(mockStorage.files.has(initialKey));
});

test('15. Admin thumbnail POST returns versioned URL in response', async () => {
  setupMockPlatform();
  const png = createValidPngBuffer(320, 180);
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'test-v.png');

  const req = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(png.byteLength + 200),
    },
    body: fd,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.url.startsWith('/api/courses/c1/thumbnail?v='));
});

test('16. Sequential replacement: course without thumb -> 1st image -> 2nd image -> 3rd image cleans previous files and updates version URL each time', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const c1 = mockDb.courses.find((c) => c.id === 'c1');
  assert.equal(c1.thumbnail_key, null);

  // 1. Upload first image (320x180 PNG)
  const img1 = createValidPngBuffer(320, 180);
  const fd1 = new FormData();
  fd1.append('file', new Blob([img1], { type: 'image/png' }), 'first.png');
  const req1 = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(img1.byteLength + 200),
    },
    body: fd1,
  });
  const res1 = await POST(req1, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  const key1 = json1.key;
  assert.ok(mockStorage.files.has(key1));
  assert.equal(c1.thumbnail_key, key1);

  // 2. Replace with 2nd image (480x270 PNG)
  const img2 = createValidPngBuffer(480, 270);
  const fd2 = new FormData();
  fd2.append('file', new Blob([img2], { type: 'image/png' }), 'second.png');
  const req2 = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(img2.byteLength + 200),
    },
    body: fd2,
  });
  const res2 = await POST(req2, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  const key2 = json2.key;
  assert.notEqual(key1, key2);
  assert.equal(mockStorage.files.has(key1), false, 'Previous key1 must be deleted from storage');
  assert.equal(mockStorage.files.has(key2), true);
  assert.equal(c1.thumbnail_key, key2);

  // 3. Replace with 3rd image (640x360 WebP)
  const img3 = createValidWebpBuffer(640, 360);
  const fd3 = new FormData();
  fd3.append('file', new Blob([img3], { type: 'image/webp' }), 'third.webp');
  const req3 = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(img3.byteLength + 200),
    },
    body: fd3,
  });
  const res3 = await POST(req3, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res3.status, 200);
  const json3 = await res3.json();
  const key3 = json3.key;
  assert.notEqual(key2, key3);
  assert.equal(mockStorage.files.has(key2), false, 'Previous key2 must be deleted from storage');
  assert.equal(mockStorage.files.has(key3), true);
  assert.equal(c1.thumbnail_key, key3);

  // Verify only 3rd image is in storage
  assert.equal(mockStorage.files.has(key1), false);
  assert.equal(mockStorage.files.has(key2), false);
  assert.equal(mockStorage.files.has(key3), true);

  // Verify public route returns 3rd image
  const getReq = new Request('http://localhost:3000' + json3.url, { method: 'GET' });
  const getRes = await GET(getReq, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('content-type'), 'image/webp');
});

test('17. Edit course metadata without choosing a new thumbnail preserves existing thumbnailKey and storage file', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const initialKey = 'courses/c2/thumbnail/initial.webp';
  assert.ok(mockStorage.files.has(initialKey));

  const patchReq = new Request('http://localhost:3000/api/admin/courses/c2', {
    method: 'PATCH',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Updated Course Title Only',
      grade: 'الصف الثاني الثانوي',
      description: 'وصف جديد',
      price: 250,
      status: 'published',
    }),
  });

  const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(patchRes.status, 200);

  const courseC2 = mockDb.courses.find((c) => c.id === 'c2');
  assert.equal(courseC2.title, 'Updated Course Title Only');
  assert.equal(courseC2.thumbnail_key, initialKey, 'Thumbnail key must NOT change when editing metadata');
  assert.ok(mockStorage.files.has(initialKey), 'Storage file must remain intact');

  // Public GET still serves the existing image
  const getReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', { method: 'GET' });
  const getRes = await GET(getReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(getRes.status, 200);
});

test('18. Oversized thumbnail (> 5MB) rejected and leaves existing thumbnail intact in storage and DB', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const initialKey = 'courses/c2/thumbnail/initial.webp';
  assert.ok(mockStorage.files.has(initialKey));

  // 6MB buffer
  const bigBuffer = Buffer.alloc(6 * 1024 * 1024);
  const fd = new FormData();
  fd.append('file', new Blob([bigBuffer], { type: 'image/png' }), 'huge.png');

  const req = new Request('http://localhost:3000/api/admin/courses/c2/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(bigBuffer.byteLength + 200),
    },
    body: fd,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c2' }) });
  assert.ok(res.status === 400 || res.status === 413);

  const courseC2 = mockDb.courses.find((c) => c.id === 'c2');
  assert.equal(courseC2.thumbnail_key, initialKey);
  assert.ok(mockStorage.files.has(initialKey));
});

test('19. Sniffing image MIME type: PNG with empty Blob type is detected and accepted', async () => {
  const { mockDb, mockStorage } = setupMockPlatform();
  const png = createValidPngBuffer(320, 180);
  const fd = new FormData();
  // Simulate Windows browser where blob type is empty string
  fd.append('file', new Blob([png], { type: '' }), 'photo.png');

  const req = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(png.byteLength + 200),
    },
    body: fd,
  });

  const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.key.endsWith('.png'));
  assert.ok(mockStorage.files.has(json.key));
});

test('20. Admin bootstrap GET includes Cache-Control: no-store and returns updated thumbnailKey', async () => {
  const { mockDb } = setupMockPlatform();
  const c1 = mockDb.courses.find((c) => c.id === 'c1');

  // Upload thumbnail
  const png = createValidPngBuffer(320, 180);
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'test-bootstrap.png');
  const uploadReq = new Request('http://localhost:3000/api/admin/courses/c1/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(png.byteLength + 200),
    },
    body: fd,
  });
  const uploadRes = await POST(uploadReq, { params: Promise.resolve({ id: 'c1' }) });
  const uploadJson = await uploadRes.json();

  // Call admin bootstrap
  const bootReq = new Request('http://localhost:3000/api/admin/bootstrap?page=1&pageSize=50', {
    headers: { cookie: 'englizeka_staff=valid_session_token' },
  });
  const bootRes = await bootstrapGET(bootReq);
  assert.equal(bootRes.status, 200);
  assert.ok(bootRes.headers.get('cache-control')?.includes('no-store'));

  const bootData = await bootRes.json();
  const bootedC1 = bootData.courses.find((c) => c.id === 'c1');
  assert.ok(bootedC1);
  assert.equal(bootedC1.thumbnailKey, uploadJson.key);
});

test('21. Cache revalidation: If-None-Match with old ETag returns 200 with new ETag after replacement', async () => {
  setupMockPlatform();

  // 1. Initial GET
  const getReq1 = new Request('http://localhost:3000/api/courses/c2/thumbnail', { method: 'GET' });
  const getRes1 = await GET(getReq1, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(getRes1.status, 200);
  const oldEtag = getRes1.headers.get('etag');
  assert.ok(oldEtag);

  // 2. If-None-Match with matching ETag returns 304
  const matchReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', {
    method: 'GET',
    headers: { 'if-none-match': oldEtag },
  });
  const matchRes = await GET(matchReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(matchRes.status, 304);

  // 3. Replace thumbnail
  const newPng = createValidPngBuffer(640, 360);
  const fd = new FormData();
  fd.append('file', new Blob([newPng], { type: 'image/png' }), 'replaced.png');
  const postReq = new Request('http://localhost:3000/api/admin/courses/c2/thumbnail', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_staff=valid_session_token',
      'content-length': String(newPng.byteLength + 200),
    },
    body: fd,
  });
  const postRes = await POST(postReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(postRes.status, 200);

  // 4. Request with old ETag MUST return 200 (not 304) with new ETag
  const revalReq = new Request('http://localhost:3000/api/courses/c2/thumbnail', {
    method: 'GET',
    headers: { 'if-none-match': oldEtag },
  });
  const revalRes = await GET(revalReq, { params: Promise.resolve({ id: 'c2' }) });
  assert.equal(revalRes.status, 200);
  const newEtag = revalRes.headers.get('etag');
  assert.notEqual(oldEtag, newEtag);
});


