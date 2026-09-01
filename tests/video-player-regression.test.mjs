import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parsePlayerCommand,
  parsePlayerEvent,
} from '../app/components/VideoPlayer/playerProtocol.ts';
import {
  clampSeekTime,
  classifyTapAction,
  classifyPointerZone,
  formatVideoTime,
  isEditableTarget,
  keyboardActionForKey,
  normalizeVolume,
  positionFromPointer,
  shouldAutoHideControls,
  shouldReportEnded,
  shouldIgnoreGestureTarget,
} from '../app/components/VideoPlayer/playerUtils.ts';
import { buildProtectedYouTubeEmbed } from '../app/api/videos/[id]/embed/route.ts';

test('player command validation rejects malformed and out-of-bounds payloads', () => {
  assert.deepEqual(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'play' }), {
    type: 'englizeka-player-command',
    videoId: 'v1',
    command: 'play',
  });
  assert.deepEqual(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'seek', value: 42 }, 100), {
    type: 'englizeka-player-command',
    videoId: 'v1',
    command: 'seek',
    value: 42,
  });
  assert.equal(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'seek', value: '42' }, 100), null);
  assert.equal(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'seek', value: 101 }, 100), null);
  assert.equal(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'set-volume', value: -1 }), null);
  assert.equal(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'set-volume', value: 101 }), null);
  assert.equal(parsePlayerCommand({ type: 'englizeka-player-command', videoId: 'v1', command: 'destroy' }), null);
  assert.equal(parsePlayerCommand(null), null);
});

test('player event validation accepts known states and rejects malformed telemetry', () => {
  assert.deepEqual(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'ready' }), {
    type: 'englizeka-player-event',
    videoId: 'v1',
    event: 'ready',
  });
  assert.deepEqual(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'state', state: 'buffering' }), {
    type: 'englizeka-player-event',
    videoId: 'v1',
    event: 'state',
    state: 'buffering',
  });
  assert.deepEqual(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'progress', currentTime: 25, duration: 100 }), {
    type: 'englizeka-player-event',
    videoId: 'v1',
    event: 'progress',
    currentTime: 25,
    duration: 100,
  });
  assert.equal(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'state', state: 'mystery' }), null);
  assert.equal(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'progress', currentTime: -1, duration: 100 }), null);
  assert.equal(parsePlayerEvent({ type: 'englizeka-player-event', videoId: 'v1', event: 'volume', volume: Number.NaN, muted: false }), null);
  assert.equal(parsePlayerEvent({ type: 'englizeka-player-event', videoId: '', event: 'ready' }), null);
});

test('video utility behavior clamps seeks and formats long durations', () => {
  assert.equal(clampSeekTime(-10, 120), 0);
  assert.equal(clampSeekTime(50, 120), 50);
  assert.equal(clampSeekTime(130, 120), 120);
  assert.equal(clampSeekTime(Number.NaN, 120), 0);
  assert.equal(formatVideoTime(34), '0:34');
  assert.equal(formatVideoTime(5174), '1:26:14');
});

test('pointer zones use left 33 percent, center 34 percent, and right 33 percent', () => {
  assert.equal(classifyPointerZone(32.9, 100), 'left');
  assert.equal(classifyPointerZone(33, 100), 'center');
  assert.equal(classifyPointerZone(66.9, 100), 'center');
  assert.equal(classifyPointerZone(67, 100), 'right');
  assert.equal(classifyPointerZone(-5, 100), 'left');
  assert.equal(classifyPointerZone(105, 100), 'right');
});

test('keyboard shortcuts exclude editable targets', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget(null), false);
});

test('tap classification separates center singles from side double taps', () => {
  assert.equal(classifyTapAction('center'), 'toggle');
  assert.equal(classifyTapAction('left'), 'none');
  assert.equal(classifyTapAction('right'), 'none');
  assert.equal(classifyTapAction('left', 'left'), 'backward');
  assert.equal(classifyTapAction('right', 'right'), 'forward');
  assert.equal(classifyTapAction('center', 'center'), 'none');
  assert.equal(classifyTapAction('left', 'right'), 'none');
});

test('gesture targets exclude buttons, sliders, links, and marked controls', () => {
  assert.equal(shouldIgnoreGestureTarget({ closest: (selector) => selector.includes('button') ? {} : null }), true);
  assert.equal(shouldIgnoreGestureTarget({ closest: (selector) => selector.includes('[data-player-interactive]') ? {} : null }), true);
  assert.equal(shouldIgnoreGestureTarget({ closest: () => null }), false);
  assert.equal(shouldIgnoreGestureTarget(null), false);
});

test('pointer position maps to a bounded scrub time', () => {
  assert.equal(positionFromPointer(50, 0, 200, 120), 30);
  assert.equal(positionFromPointer(-50, 0, 200, 120), 0);
  assert.equal(positionFromPointer(250, 0, 200, 120), 120);
  assert.equal(positionFromPointer(50, 0, 0, 120), 0);
});

test('controls auto-hide only while playing and inactive', () => {
  assert.equal(shouldAutoHideControls('playing', false, false), true);
  assert.equal(shouldAutoHideControls('paused', false, false), false);
  assert.equal(shouldAutoHideControls('ended', false, false), false);
  assert.equal(shouldAutoHideControls('playing', true, false), false);
  assert.equal(shouldAutoHideControls('playing', false, true), false);
});

test('focused-player keyboard shortcuts map without hijacking unrelated keys', () => {
  assert.equal(keyboardActionForKey(' '), 'toggle');
  assert.equal(keyboardActionForKey('Spacebar'), 'toggle');
  assert.equal(keyboardActionForKey('ArrowRight'), 'forward');
  assert.equal(keyboardActionForKey('ArrowLeft'), 'backward');
  assert.equal(keyboardActionForKey('m'), 'mute');
  assert.equal(keyboardActionForKey('F'), 'fullscreen');
  assert.equal(keyboardActionForKey('Enter'), null);
});

test('volume normalization clamps finite values and rejects invalid numbers', () => {
  assert.equal(normalizeVolume(45), 45);
  assert.equal(normalizeVolume(-5), 0);
  assert.equal(normalizeVolume(120), 100);
  assert.equal(normalizeVolume(Number.NaN), 100);
});

test('completion is reported once per ended transition and may retry after replay', () => {
  assert.equal(shouldReportEnded('playing', 'ended'), true);
  assert.equal(shouldReportEnded('ended', 'ended'), false);
  assert.equal(shouldReportEnded('ended', 'playing'), false);
  assert.equal(shouldReportEnded('playing', 'ended'), true);
});

test('protected embed disables native YouTube UI and exposes one validated protocol', () => {
  const html = buildProtectedYouTubeEmbed({
    youtubeId: 'dQw4w9WgXcQ',
    lessonId: 'lesson-1',
    origin: 'https://englizeka.test',
  });

  assert.match(html, /controls:\s*0/);
  assert.match(html, /cc_load_policy:\s*0/);
  assert.match(html, /disablekb:\s*1/);
  assert.match(html, /fs:\s*0/);
  assert.match(html, /iv_load_policy:\s*3/);
  assert.match(html, /playsinline:\s*1/);
  assert.match(html, /rel:\s*0/);
  assert.equal((html.match(/playsinline:\s*1/g) || []).length, 1);
  assert.doesNotMatch(html, /modestbranding/);
  assert.match(html, /event\.source !== window\.parent/);
  assert.match(html, /event\.origin !== allowedOrigin/);
  assert.match(html, /data\.videoId !== lessonId/);
  assert.match(html, /\['play', 'pause', 'seek', 'set-volume', 'mute', 'unmute'\]/);
  assert.match(html, /Number\.isFinite\(data\.value\)/);
  assert.match(html, /data\.value >= 0 && data\.value <= 100/);
});

test('protected embed uses one playback-only progress interval with complete cleanup', () => {
  const html = buildProtectedYouTubeEmbed({
    youtubeId: 'dQw4w9WgXcQ',
    lessonId: 'lesson-1',
    origin: 'https://englizeka.test',
  });

  assert.equal((html.match(/setInterval\(/g) || []).length, 1);
  assert.match(html, /setInterval\(reportProgress, 500\)/);
  assert.match(html, /startProgress/);
  assert.match(html, /stopProgress/);
  assert.match(html, /beforeunload/);
  assert.match(html, /send\('ready'\)/);
  assert.match(html, /send\('volume'/);
  assert.match(html, /send\('error'/);
});

test('secure lesson orchestrator delegates playback to the isolated player subsystem', async () => {
  const source = await readFile(new URL('../app/components/SecureVideoPlayer.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ EnglizekaPlayer \} from '\.\/VideoPlayer'/);
  assert.match(source, /<EnglizekaPlayer/);
  assert.doesNotMatch(source, /<iframe/);
  assert.doesNotMatch(source, /englizeka-video-controls/);
});
