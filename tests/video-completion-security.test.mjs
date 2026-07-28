import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createSignedVideoCompletionToken,
  requiredVideoWatchMs,
  verifySignedVideoCompletionToken,
  VIDEO_COMPLETION_TOKEN_AFTER_READY_TTL_MS,
} from '../app/lib/video-token.ts';

test('lesson completion proof is signed, student-bound, lesson-bound, delayed, and expiring', async () => {
  const secret = 'test-video-completion-secret-that-is-long-enough';
  const now = 1_800_000_000_000;
  const requiredWatch = requiredVideoWatchMs(100);
  const token = await createSignedVideoCompletionToken(
    secret,
    'Student@Example.test',
    'lesson-1',
    100,
    now
  );

  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      token,
      'student@example.test',
      'lesson-1',
      now + requiredWatch - 1
    ),
    false
  );
  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      token,
      'student@example.test',
      'lesson-1',
      now + requiredWatch
    ),
    true
  );
  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      token,
      'other@example.test',
      'lesson-1',
      now + requiredWatch
    ),
    false
  );
  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      token,
      'student@example.test',
      'lesson-2',
      now + requiredWatch
    ),
    false
  );
  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      `${token.slice(0, -1)}x`,
      'student@example.test',
      'lesson-1',
      now + requiredWatch
    ),
    false
  );
  assert.equal(
    await verifySignedVideoCompletionToken(
      secret,
      token,
      'student@example.test',
      'lesson-1',
      now + requiredWatch + VIDEO_COMPLETION_TOKEN_AFTER_READY_TTL_MS
    ),
    false
  );

  const route = await readFile(
    new URL('../app/api/videos/[id]/complete/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(route, /verifyVideoCompletionToken\(completionToken, email, id\)/);
});
