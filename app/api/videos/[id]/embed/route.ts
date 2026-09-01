import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { authorizeVideoAccess, verifyVideoEmbedToken } from '../../../../lib/video-access';

export function buildProtectedYouTubeEmbed({
  youtubeId,
  lessonId,
  origin,
}: {
  youtubeId: string;
  lessonId: string;
  origin: string;
}): string {
  const encodedYoutubeId = JSON.stringify(youtubeId);
  const encodedLessonId = JSON.stringify(lessonId);
  const encodedOrigin = JSON.stringify(origin);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html,body,#player{width:100%;height:100%;margin:0;background:#000;overflow:hidden}#player{pointer-events:none}</style>
</head>
<body oncontextmenu="return false">
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    (function () {
      'use strict';
      var allowedOrigin = ${encodedOrigin};
      var lessonId = ${encodedLessonId};
      var player = null;
      var playerReady = false;
      var progressTimer = null;
      var allowedCommands = ['play', 'pause', 'seek', 'set-volume', 'mute', 'unmute', 'request-status'];

      function send(event, payload) {
        window.parent.postMessage(Object.assign({
          type: 'englizeka-player-event',
          videoId: lessonId,
          event: event
        }, payload || {}), allowedOrigin);
      }

      function reportProgress() {
        if (!playerReady || !player) return;
        var currentTime = player.getCurrentTime();
        var duration = player.getDuration();
        if (Number.isFinite(currentTime) && currentTime >= 0 && Number.isFinite(duration) && duration >= 0) {
          send('progress', { currentTime: currentTime, duration: duration });
        }
      }

      function reportVolume() {
        if (!playerReady || !player) return;
        var volume = player.getVolume();
        if (Number.isFinite(volume) && volume >= 0 && volume <= 100) {
          send('volume', { volume: volume, muted: player.isMuted() === true });
        }
      }

      function sendReadySnapshot() {
        if (!playerReady || !player) return;
        send('ready');
        reportProgress();
        reportVolume();
      }

      function stopProgress() {
        if (progressTimer !== null) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      }

      function startProgress() {
        stopProgress();
        reportProgress();
        progressTimer = setInterval(reportProgress, 500);
      }

      function stateName(state) {
        if (state === YT.PlayerState.PLAYING) return 'playing';
        if (state === YT.PlayerState.PAUSED) return 'paused';
        if (state === YT.PlayerState.BUFFERING) return 'buffering';
        if (state === YT.PlayerState.ENDED) return 'ended';
        return 'unstarted';
      }

      window.onYouTubeIframeAPIReady = function () {
        player = new YT.Player('player', {
          videoId: ${encodedYoutubeId},
          playerVars: {
            controls: 0,
            cc_load_policy: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            rel: 0,
            origin: allowedOrigin
          },
          events: {
            onReady: function () {
              playerReady = true;
              sendReadySnapshot();
            },
            onStateChange: function (event) {
              var state = stateName(event.data);
              send('state', { state: state });
              if (state === 'playing') startProgress();
              else stopProgress();
              if (state === 'ended') reportProgress();
            },
            onError: function (event) {
              stopProgress();
              send('error', { code: Number.isFinite(event.data) ? event.data : 0 });
            }
          }
        });
      };

      window.addEventListener('message', function (event) {
        if (event.source !== window.parent || event.origin !== allowedOrigin) return;
        var data = event.data;
        if (!data || data.type !== 'englizeka-player-command' || data.videoId !== lessonId) return;
        if (allowedCommands.indexOf(data.command) === -1) return;
        if (data.command === 'request-status') {
          sendReadySnapshot();
          return;
        }
        if (!playerReady || !player) return;
        if (data.command === 'play') player.playVideo();
        else if (data.command === 'pause') player.pauseVideo();
        else if (data.command === 'mute') { player.mute(); reportVolume(); }
        else if (data.command === 'unmute') { player.unMute(); reportVolume(); }
        else if (data.command === 'set-volume') {
          if (Number.isFinite(data.value) && data.value >= 0 && data.value <= 100) {
            player.setVolume(data.value);
            reportVolume();
          }
        } else if (data.command === 'seek') {
          var duration = player.getDuration();
          if (Number.isFinite(data.value) && data.value >= 0 && Number.isFinite(duration) && duration > 0 && data.value <= duration) {
            player.seekTo(data.value, true);
            reportProgress();
          }
        }
      });

      window.addEventListener('beforeunload', stopProgress);
    })();
  </script>
</body>
</html>`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!(await verifyVideoEmbedToken(token, user.email, id))) {
    return new Response('انتهت صلاحية رابط تشغيل الفيديو', { status: 403 });
  }

  const access = await authorizeVideoAccess(user.email, id);
  if (!access.ok || access.video.sourceType !== 'youtube' || !access.video.youtubeId) {
    return new Response(access.ok ? 'الفيديو غير متاح' : access.error, {
      status: access.ok ? 404 : access.status,
    });
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(access.video.youtubeId)) {
    return new Response('مصدر الفيديو غير صالح', { status: 500 });
  }

  const html = buildProtectedYouTubeEmbed({
    youtubeId: access.video.youtubeId,
    lessonId: id,
    origin: new URL(request.url).origin,
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src https://www.youtube.com https://*.googlevideo.com; img-src data: https://i.ytimg.com https://*.ggpht.com; style-src 'unsafe-inline'; frame-ancestors 'self'",
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
    },
  });
}
