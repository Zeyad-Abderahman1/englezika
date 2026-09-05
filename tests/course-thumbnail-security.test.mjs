import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isImageUpload,
  getImageExtension,
  getImageDimensions,
  hasReasonableCourseThumbnailDimensions,
  MAX_IMAGE_SIZE,
} from '../app/lib/upload-validation.ts';
import { POST, DELETE } from '../app/api/admin/courses/[id]/thumbnail/route.ts';
import { GET } from '../app/api/courses/[id]/thumbnail/route.ts';

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
    { id: 'c1', title: 'Course Without Thumb', thumbnail_key: null },
    { id: 'c2', title: 'Course With Thumb', thumbnail_key: 'courses/c2/thumbnail/initial.webp' },
  ];

  const storageFiles = new Map();
  // Pre-seed an initial thumbnail for c2
  const initialPng = createValidPngBuffer(320, 180);
  storageFiles.set('courses/c2/thumbnail/initial.webp', initialPng);

  const mockDb = {
    courses,
    prepare(sql) {
      return {
        bind(...args) {
          return {
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
                return { id: c.id, thumbnailKey: c.thumbnail_key };
              }
              return null;
            },
            async run() {
              if (sql.includes('UPDATE courses SET thumbnail_key = ?')) {
                const [key, , id] = args;
                const c = courses.find((x) => x.id === id);
                if (c) {
                  c.thumbnail_key = key;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes('UPDATE courses SET thumbnail_key = NULL')) {
                const [, id] = args;
                const c = courses.find((x) => x.id === id);
                if (c) {
                  c.thumbnail_key = null;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
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
