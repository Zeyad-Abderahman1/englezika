/**
 * Stage 7 — Lecture Materials — Security Tests
 *
 * Validates:
 * 1. Admin materials CRUD endpoints exist with correct auth
 * 2. Student materials list endpoint requires enrollment
 * 3. Student materials download requires enrollment
 * 4. Sequence unlock enforced on student materials
 * 5. Materials stored in private storage
 * 6. Student payload never exposes file_key
 * 7. Admin upload validates PDF only
 * 8. Admin upload enforces size limit
 * 9. Admin delete cleans up storage
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('admin materials CRUD', () => {
  test('GET requires manage_videos permission', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('manage_videos'), 'Requires manage_videos');
  });

  test('POST requires same-origin', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'POST requires same-origin');
  });

  test('POST validates PDF upload', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('isPdfUpload'), 'Validates PDF');
    assert.ok(content.includes('MAX_MATERIAL_SIZE'), 'Enforces size limit');
  });

  test('POST stores in private storage', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('getPrivateStorage'), 'Uses private storage');
    assert.ok(content.includes('videos/${id}/materials/'), 'Correct storage path');
  });

  test('DELETE requires manage_videos permission', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('manage_videos'), 'DELETE requires manage_videos');
  });

  test('DELETE cleans up storage files', async () => {
    const content = await readFile('app/api/admin/videos/[id]/materials/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('storage.delete'), 'DELETE cleans up storage');
  });
});

describe('student materials list/download', () => {
  test('requires authentication', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('apiVerifiedUser'), 'Requires authentication');
  });

  test('checks enrollment', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('enrollments'), 'Checks enrollment');
  });

  test('checks course sequence unlock', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('hasCourseItems'), 'Checks course sequence');
    assert.ok(content.includes('getCourseSequenceUnlockState'), 'Gets unlock state');
  });

  test('returns materials list without file_key', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    // The list response map should only include id, fileName, fileSize
    assert.ok(content.includes('id: m.id'), 'Returns id');
    assert.ok(content.includes('fileName: m.fileName'), 'Returns fileName');
    assert.ok(content.includes('fileSize: m.fileSize'), 'Returns fileSize');
    // The list response section (before download section) should not expose storageKey
    const mapStart = content.indexOf('materials.results.map((m) => (');
    const mapSection = content.slice(mapStart, mapStart + 200);
    assert.ok(!mapSection.includes('storageKey'), 'Does not expose storageKey in list');
  });

  test('download serves from private storage', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('storage.get(material.storageKey)'), 'Downloads from private storage');
  });

  test('download sets safe headers', async () => {
    const content = await readFile('app/api/student/videos/[id]/materials/route.ts', 'utf-8');
    assert.ok(content.includes('Cache-Control'), 'Sets cache-control');
    assert.ok(content.includes('no-store'), 'Uses no-store');
    assert.ok(content.includes('Content-Disposition'), 'Sets content-disposition');
  });
});
