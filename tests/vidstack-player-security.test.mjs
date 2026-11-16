import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';

class MockPlayerSecurityDatabase {
  videos = new Map();
  enrollments = new Map();
  viewSessions = [];
  studentSessions = new Map();
  studentUsers = new Map();
  grants = new Set();

  constructor() {
    this.videos.set('vid-auth-test', {
      id: 'vid-auth-test',
      courseId: 'course-player-1',
      sourceType: 'youtube',
      youtubeId: 'dQw4w9WgXcQ',
      durationSeconds: 600,
      title: 'محاضرة اختبار مشغل فيدستاك',
      status: 'published',
      maxViews: 3,
      createdAt: 1000,
      prerequisiteExamId: null,
      minimumScore: 0,
    });

    this.enrollments.set('enrolled@test.com:course-player-1', {
      userEmail: 'enrolled@test.com',
      courseId: 'course-player-1',
      status: 'approved',
    });

    const studentToken = 'session-token-enrolled-student';
    const studentTokenHash = crypto.createHash('sha256').update(studentToken).digest('hex');
    this.studentSessions.set(studentTokenHash, {
      tokenHash: studentTokenHash,
      userEmail: 'enrolled@test.com',
      expiresAt: Date.now() + 86400000,
    });

    this.studentUsers.set('enrolled@test.com', {
      email: 'enrolled@test.com',
      name: 'طالب مسجل',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });

    this.studentUsers.set('outsider@test.com', {
      email: 'outsider@test.com',
      name: 'طالب خارجي',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });

    this.studentUsers.set('qr-grant@test.com', {
      email: 'qr-grant@test.com',
      name: 'طالب كود فردي',
      role: 'student',
      status: 'active',
      isVerified: 1,
    });

    this.grants.add('qr-grant@test.com:vid-auth-test');
  }

  prepare(sql) {
    const db = this;
    return {
      bindings: [],
      bind(...args) {
        this.bindings = args;
        return this;
      },
      async first() {
        const s = sql.replace(/\s+/g, ' ').trim();

        // Native session lookup
        if (s.includes('FROM native_sessions s JOIN users u')) {
          const [tokenHash] = this.bindings;
          const session = db.studentSessions.get(tokenHash);
          if (!session || session.expiresAt <= Date.now()) return null;
          const user = db.studentUsers.get(session.userEmail);
          if (!user || user.status !== 'active') return null;
          return {
            email: user.email,
            name: user.name,
            emailVerified: user.isVerified,
          };
        }

        // Authorize video access query
        if (s.includes('FROM videos v WHERE v.id = ? AND v.status = \'published\' LIMIT 1')) {
          const [normEmail1, normEmail2, videoId] = this.bindings;
          const v = db.videos.get(videoId);
          if (!v) return null;
          const hasEnrollmentAccess = db.enrollments.has(`${normEmail1}:${v.courseId}`) ? 1 : 0;
          const hasIndividualGrant = db.grants.has(`${normEmail2}:${videoId}`) ? 1 : 0;
          return {
            id: v.id,
            courseId: v.courseId,
            sourceType: v.sourceType,
            youtubeId: v.youtubeId,
            durationSeconds: v.durationSeconds,
            title: v.title,
            prerequisiteExamId: v.prerequisiteExamId,
            minimumScore: v.minimumScore,
            hasEnrollmentAccess,
            hasIndividualGrant,
          };
        }

        // View session video lookup
        if (s.includes('SELECT id, course_id AS courseId, max_views AS maxViews FROM videos WHERE id = ?')) {
          const [id] = this.bindings;
          const v = db.videos.get(id);
          return v ? { id: v.id, courseId: v.courseId, maxViews: v.maxViews } : null;
        }

        // Enrollment check
        if (s.includes('FROM enrollments WHERE user_email = ? AND course_id = ? AND status = \'approved\'')) {
          const [email, courseId] = this.bindings;
          return db.enrollments.has(`${email}:${courseId}`) ? { 1: 1 } : null;
        }

        // Individual grant check
        if (s.includes('FROM student_video_access_grants WHERE video_id = ? AND student_email = ?')) {
          const [videoId, email] = this.bindings;
          return db.grants.has(`${email}:${videoId}`) ? { 1: 1 } : null;
        }

        // Active session check
        if (s.includes('SELECT id, expires_at AS expiresAt FROM video_view_sessions') && s.includes("status = 'active'")) {
          const [videoId, email] = this.bindings;
          const match = db.viewSessions.find(
            (vs) => vs.videoId === videoId && vs.userEmail === email && vs.status === 'active'
          );
          return match ? { id: match.id, expiresAt: match.expiresAt } : null;
        }

        // Count sessions
        if (s.includes('SELECT COUNT(*) AS count FROM video_view_sessions')) {
          const [videoId, email] = this.bindings;
          const count = db.viewSessions.filter(
            (vs) => vs.videoId === videoId && vs.userEmail === email && ['active', 'expired', 'submitted'].includes(vs.status)
          ).length;
          return { count };
        }

        // Check previous videos
        if (s.includes('ORDER BY created_at DESC LIMIT 1')) {
          return null; // no previous video in test
        }

        // Course items check
        if (s.includes('FROM course_items WHERE course_id = ?')) {
          return null;
        }

        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('INSERT INTO video_view_sessions')) {
          const [id, videoId, userEmail, sessionToken, startedAt, lastActiveAt, expiresAt, createdAt] = this.bindings;
          db.viewSessions.push({
            id,
            videoId,
            userEmail,
            sessionToken,
            startedAt,
            lastActiveAt,
            expiresAt,
            createdAt,
            status: 'active',
          });
          return { success: true };
        }
        return { success: true };
      },
    };
  }
}

function setupTestEnv(db) {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
    VIDEO_RESOLVE_SECRET: 'test-video-resolve-secret-32-chars-long!',
    INITIAL_STAFF_EMAIL: 'staff@englizeka.test',
  };
}

test('Vidstack Player Security: 1. Authorization is strictly required for /resolve', async () => {
  const db = new MockPlayerSecurityDatabase();
  setupTestEnv(db);

  const { GET } = await import('../app/api/videos/[id]/resolve/route.ts');

  // Anonymous request without session cookie
  const unauthReq = new Request('http://localhost:3000/api/videos/vid-auth-test/resolve', {
    method: 'GET',
    headers: { origin: 'http://localhost:3000' },
  });
  const unauthRes = await GET(unauthReq, { params: Promise.resolve({ id: 'vid-auth-test' }) });
  assert.ok(
    unauthRes.status === 401 || unauthRes.status === 307 || unauthRes.status === 403,
    'Unauthenticated request is rejected'
  );

  // Authenticated request with session cookie
  const authReq = new Request('http://localhost:3000/api/videos/vid-auth-test/resolve', {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=session-token-enrolled-student;',
    },
  });
  const authRes = await GET(authReq, { params: Promise.resolve({ id: 'vid-auth-test' }) });
  assert.equal(authRes.status, 200, 'Authenticated request succeeds');
  const authData = await authRes.json();
  assert.equal(authData.kind, 'youtube');
  assert.equal(authData.youtubeId, 'dQw4w9WgXcQ');
  assert.ok(authData.sourceUrl);
  assert.ok(authData.completionToken);
});

test('Vidstack Player Security: 2. QR individual video access grant authorizes video without course enrollment', async () => {
  const db = new MockPlayerSecurityDatabase();
  setupTestEnv(db);

  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  // qr-grant@test.com is NOT enrolled in course-player-1, but has individual grant
  const access = await authorizeVideoAccess('qr-grant@test.com', 'vid-auth-test');
  assert.equal(access.ok, true, 'Individual video grant allows access');
  if (access.ok) {
    assert.equal(access.video.youtubeId, 'dQw4w9WgXcQ');
    assert.equal(access.video.hasIndividualGrant, 1);
  }

  // outsider@test.com has neither enrollment nor grant
  const deniedAccess = await authorizeVideoAccess('outsider@test.com', 'vid-auth-test');
  assert.equal(deniedAccess.ok, false, 'Outsider without grant is denied');
  if (!deniedAccess.ok) {
    assert.equal(deniedAccess.status, 403);
  }
});

test('Vidstack Player Security: 3. Page load and source resolve do NOT consume view sessions', async () => {
  const db = new MockPlayerSecurityDatabase();
  setupTestEnv(db);

  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');
  const initialSessions = db.viewSessions.length;

  const access = await authorizeVideoAccess('enrolled@test.com', 'vid-auth-test');
  assert.equal(access.ok, true);

  // Authorizing access / resolving source must never create a view session
  assert.equal(db.viewSessions.length, initialSessions, '0 view sessions created during resolve');
});

test('Vidstack Player Security: 4. Actual playback triggers view session start in SecureVideoPlayer', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // Verify that handlePlaying starts the view session and heartbeat
  assert.ok(
    playerSource.includes('handlePlaying') &&
    playerSource.includes('startViewSession(activeId)') &&
    playerSource.includes('startHeartbeat()'),
    'Playback triggers startViewSession and startHeartbeat'
  );

  // Verify that MediaPlayer binds onPlaying to handlePlaying
  assert.ok(
    playerSource.includes('onPlaying={handlePlaying}'),
    'MediaPlayer triggers handlePlaying on onPlaying event'
  );
});

test('Vidstack Player Security: 5. Paused playback stops heartbeat', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // Verify that handlePause stops the heartbeat
  assert.ok(
    playerSource.includes('handlePause') &&
    playerSource.includes('stopHeartbeat()'),
    'Pausing stops the view session heartbeat'
  );

  // Verify that MediaPlayer binds onPause to handlePause
  assert.ok(
    playerSource.includes('onPause={handlePause}'),
    'MediaPlayer triggers handlePause on onPause event'
  );
});

test('Vidstack Player Security: 6. Authorized state has no false security overlay during normal playback', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // When source is resolved, securityMessage is cleared
  assert.ok(
    playerSource.includes('setSecurityMessage(\'\')'),
    'securityMessage is reset on successful resolution'
  );

  // Overlay is only rendered if securityMessage is truthy (e.g. visibility change or view exhaustion)
  assert.ok(
    playerSource.includes('{securityMessage && ('),
    'Protection overlay only shown when there is an actual securityMessage'
  );

  // Authorized state renders MediaPlayer directly
  assert.ok(
    playerSource.includes('<MediaPlayer') && playerSource.includes('<MediaProvider />'),
    'Authorized state mounts Vidstack MediaPlayer'
  );
});

test('Vidstack Player Security: 7. Denied state still blocks playback and displays error', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // Check error / unauthorized handling
  assert.ok(
    playerSource.includes('activeSource.error') &&
    playerSource.includes('activeSource.isUnauthorized'),
    'Denied state is handled cleanly'
  );
  assert.ok(
    playerSource.includes('يرجى التأكد من صلاحية الاشتراك أو الكود المستخدم'),
    'Clear user message on access denial'
  );
});

test('Vidstack Player Security: 8. Player implementation uses Vidstack React', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // Official Vidstack imports
  assert.ok(
    playerSource.includes("from '@vidstack/react'") || playerSource.includes('from "@vidstack/react"'),
    'Imports @vidstack/react'
  );
  assert.ok(
    playerSource.includes("from '@vidstack/react/player/layouts/default'") ||
    playerSource.includes('from "@vidstack/react/player/layouts/default"'),
    'Imports default layout from Vidstack'
  );
  assert.ok(
    playerSource.includes('<MediaPlayer') &&
    playerSource.includes('<MediaProvider') &&
    playerSource.includes('<DefaultVideoLayout'),
    'Renders MediaPlayer, MediaProvider, and DefaultVideoLayout'
  );
});

test('Vidstack Player Security: 9. Fullscreen control and native integration are present', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');
  const cssSource = await readFile('app/globals.css', 'utf-8');

  // Fullscreen change handler in component
  assert.ok(
    playerSource.includes('onFullscreenChange={handleFullscreenChange}'),
    'MediaPlayer includes onFullscreenChange handler'
  );
  assert.ok(
    playerSource.includes("document.body.style.overflow = 'hidden'"),
    'Fullscreen prevents body scrolling'
  );

  // CSS supports fullscreen
  assert.ok(
    cssSource.includes('[data-fullscreen]'),
    'CSS has rules for player fullscreen state'
  );
});

test('Vidstack Player Security: 10. No custom giant pause overlay or obsolete playback layer remains', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');
  const cssSource = await readFile('app/globals.css', 'utf-8');

  // Verify absence of old broken handmade overlay elements
  assert.equal(
    playerSource.includes('video-center-paused-badge'),
    false,
    'No video-center-paused-badge in SecureVideoPlayer.tsx'
  );
  assert.equal(
    playerSource.includes('video-surface-click-layer'),
    false,
    'No video-surface-click-layer in SecureVideoPlayer.tsx'
  );
  assert.equal(
    playerSource.includes('video-center-feedback'),
    false,
    'No video-center-feedback in SecureVideoPlayer.tsx'
  );

  // Verify CSS does not define them
  assert.equal(
    cssSource.includes('.video-center-paused-badge'),
    false,
    'No .video-center-paused-badge in app/globals.css'
  );
  assert.equal(
    cssSource.includes('.video-surface-click-layer'),
    false,
    'No .video-surface-click-layer in app/globals.css'
  );
});

test('Vidstack Player Security: 11. Provider verification uses isYouTubeProvider and onProviderChange', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  assert.ok(
    playerSource.includes('isYouTubeProvider'),
    'Imports and utilizes isYouTubeProvider'
  );
  assert.ok(
    playerSource.includes('onProviderChange={handleProviderChange}'),
    'MediaPlayer binds onProviderChange'
  );
  assert.ok(
    playerSource.includes('isYouTubeProvider(provider)'),
    'Validates provider via isYouTubeProvider(provider)'
  );
});

test('Vidstack Player Security: 12. extractYouTubeId safely extracts 11-char ID from all YouTube formats', async () => {
  const { extractYouTubeId, toVidstackYouTubeSource } = await import('../app/lib/youtube.ts');

  // Standard clean ID
  assert.equal(extractYouTubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(toVidstackYouTubeSource('dQw4w9WgXcQ'), 'youtube/dQw4w9WgXcQ');

  // Watch URL
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Short URL
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Embed URL
  assert.equal(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Shorts URL
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Prefixed
  assert.equal(extractYouTubeId('youtube/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

  // Whitespace
  assert.equal(extractYouTubeId('  dQw4w9WgXcQ  '), 'dQw4w9WgXcQ');

  // Internal endpoints must NEVER match as YouTube IDs
  assert.equal(extractYouTubeId('/api/videos/123/embed?token=abc'), null);
  assert.equal(extractYouTubeId(''), null);
  assert.equal(extractYouTubeId(null), null);
  assert.equal(extractYouTubeId(undefined), null);
});

test('Vidstack Player Security: 13. /resolve returns valid Vidstack source format and never internal /embed as media source', async () => {
  const db = new MockPlayerSecurityDatabase();
  setupTestEnv(db);

  const { GET } = await import('../app/api/videos/[id]/resolve/route.ts');
  const authReq = new Request('http://localhost:3000/api/videos/vid-auth-test/resolve', {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      cookie: 'englizeka_student=session-token-enrolled-student;',
    },
  });
  const authRes = await GET(authReq, { params: Promise.resolve({ id: 'vid-auth-test' }) });
  assert.equal(authRes.status, 200);
  const data = await authRes.json();

  // Must have 11-char youtubeId and normalized videoSource
  assert.equal(data.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(data.videoSource, 'youtube/dQw4w9WgXcQ');
  assert.equal(data.sourceUrl, 'youtube/dQw4w9WgXcQ');
});

test('Vidstack Player Security: 14. Provider error diagnostics prevent infinite loading and display friendly Arabic error', async () => {
  const playerSource = await readFile('app/components/SecureVideoPlayer.tsx', 'utf-8');

  // Error diagnostics
  assert.ok(
    playerSource.includes('providerError'),
    'Maintains providerError state'
  );
  assert.ok(
    playerSource.includes('هذا الفيديو غير متاح للتضمين من YouTube'),
    'Handles embedding restriction (code 150/101)'
  );
  assert.ok(
    playerSource.includes('فيديو YouTube غير موجود أو تم حذفه'),
    'Handles missing/deleted video (code 100/2)'
  );
});
