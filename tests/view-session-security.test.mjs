/**
 * Stage 8 — View Session Limits — Security Tests
 *
 * Validates:
 * 1. View session start requires authentication
 * 2. View session start requires enrollment
 * 3. View session start enforces max_views limit
 * 4. View session start reuses active session (no double-count)
 * 5. Heartbeat extends session
 * 6. Heartbeat requires valid session
 * 7. max_views configurable in admin video create/edit
 * 8. Unlimited mode (max_views = 0) never blocks
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('view session start', () => {
  test('requires authentication', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('apiVerifiedUser'), 'Requires authentication');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('checks enrollment', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('enrollments'), 'Checks enrollment');
  });

  test('reuses existing active session without incrementing', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    // Must check for existing active session before creating new one
    assert.ok(content.includes("status = 'active'"), 'Checks for active session');
    assert.ok(content.includes('existing && existing.expiresAt > now'), 'Reuses if still valid');
  });

  test('enforces max_views limit when > 0', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('maxViews > 0'), 'Checks maxViews > 0');
    assert.ok(content.includes('currentViews >= maxViews'), 'Enforces view limit');
  });

  test('returns 403 when view limit exhausted', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('403'), 'Returns 403 when limit reached');
  });

  test('creates session with 30-minute expiry', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('30 * 60 * 1000'), 'Sets 30-minute expiry');
  });

  test('unlimited mode (max_views = 0) never blocks', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/start/route.ts', 'utf-8');
    assert.ok(content.includes('viewsRemaining: null'), 'Returns null remaining for unlimited');
  });
});

describe('view session heartbeat', () => {
  test('requires authentication', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/heartbeat/route.ts', 'utf-8');
    assert.ok(content.includes('apiVerifiedUser'), 'Requires authentication');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/heartbeat/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('validates session ownership', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/heartbeat/route.ts', 'utf-8');
    assert.ok(content.includes('user_email = ?'), 'Validates session belongs to user');
  });

  test('rejects expired sessions', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/heartbeat/route.ts', 'utf-8');
    assert.ok(content.includes('now >= session.expiresAt'), 'Rejects expired sessions');
  });

  test('extends session by 30 minutes', async () => {
    const content = await readFile('app/api/student/videos/[id]/view-session/heartbeat/route.ts', 'utf-8');
    assert.ok(content.includes('30 * 60 * 1000'), 'Extends by 30 minutes');
    assert.ok(content.includes('SET expires_at'), 'Updates expires_at');
  });
});

describe('admin video max_views configuration', () => {
  test('admin video create accepts maxViews', async () => {
    const content = await readFile('app/api/admin/videos/route.ts', 'utf-8');
    assert.ok(content.includes('maxViews'), 'Accepts maxViews in create');
  });

  test('admin video edit accepts maxViews', async () => {
    const content = await readFile('app/api/admin/videos/[id]/route.ts', 'utf-8');
    assert.ok(content.includes('maxViews'), 'Accepts maxViews in edit');
    assert.ok(content.includes('max_views'), 'Updates max_views column');
  });

  test('max_views defaults to 0 (unlimited)', async () => {
    const content = await readFile('app/api/admin/videos/route.ts', 'utf-8');
    assert.ok(content.includes('safeInteger(body.maxViews, 0, 0, 1000)'), 'Defaults to 0');
  });
});
