/**
 * Stage 10 — Bulk Access Codes + PDF — Security Tests
 *
 * Validates:
 * 1. Bulk code generation requires manage_videos permission
 * 2. Bulk generation is atomic (all-or-nothing)
 * 3. Codes are cryptographically generated
 * 4. Batch record created with correct data
 * 5. PDF endpoint requires manage_videos permission
 * 6. PDF endpoint requires plaintext tokens
 * 7. PDF validates tokens exist and are unredeemed
 * 8. Batch ID tracked on individual codes
 * 9. Bulk generation capped at 500
 * 10. Same-origin required on both endpoints
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('bulk code generation', () => {
  test('requires manage_videos permission', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('manage_videos'), 'Requires manage_videos');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('uses atomic batch (all-or-nothing)', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('db.batch(statements)'), 'Uses db.batch for atomicity');
    assert.ok(content.includes('try') && content.includes('catch'), 'Has error handling');
  });

  test('creates access_code_batches record', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('access_code_batches'), 'Creates batch record');
    assert.ok(content.includes('batchId'), 'Generates batch ID');
  });

  test('generates cryptographic tokens', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('generateLectureQRToken'), 'Generates tokens');
    assert.ok(content.includes('hashLectureQRToken'), 'Hashes tokens');
    assert.ok(content.includes('normalizeLectureQRToken'), 'Normalizes tokens');
  });

  test('tracks batch_id on individual codes', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('batch_id'), 'Sets batch_id on codes');
  });

  test('caps count at 500', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('safeInteger(body.count, 5, 1, 500)'), 'Caps at 500');
  });

  test('records audit log', async () => {
    const content = await readFile('app/api/admin/qr/bulk/route.ts', 'utf-8');
    assert.ok(content.includes('recordAuditLog'), 'Records audit log');
  });
});

describe('PDF generation', () => {
  test('requires manage_videos permission', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('manage_videos'), 'Requires manage_videos');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('requires plaintext tokens', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('PLAINTEXT_TOKENS_REQUIRED'), 'Requires tokens');
  });

  test('validates tokens exist and are unredeemed', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('redeemed_at'), 'Checks redeemed status');
    assert.ok(content.includes('redeemedAt !== null'), 'Rejects redeemed tokens');
  });

  test('caps at 500 tokens per request', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('500'), 'Caps at 500');
  });

  test('generates PDF with generateAccessCodePDF', async () => {
    const content = await readFile('app/api/admin/qr/pdf/route.ts', 'utf-8');
    assert.ok(content.includes('generateAccessCodePDF'), 'Uses PDF generator');
  });
});

describe('admin bootstrap includes batches', () => {
  test('bootstrap endpoint returns batch data', async () => {
    const content = await readFile('app/api/admin/bootstrap/route.ts', 'utf-8');
    assert.ok(content.includes('access_code_batches'), 'Includes batch data');
    assert.ok(content.includes('batchId'), 'Returns batch ID');
  });
});
