import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { authorizeVideoAccess, verifyVideoEmbedToken } from '../../../../lib/video-access';

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

  const youtubeId = JSON.stringify(access.video.youtubeId);
  const lessonId = JSON.stringify(id);
  const embedOrigin = JSON.stringify(new URL(request.url).origin);
  const html = `<!doctype html>
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
    window.onYouTubeIframeAPIReady = function () {
      var playerReady = false;
      var pendingCommand = null;
      var progressTimer = null;
      var player = new YT.Player('player', {
        videoId: ${youtubeId},
        playerVars: { controls: 0, cc_load_policy: 0, disablekb: 1, fs: 0, modestbranding: 1, origin: ${embedOrigin}, playsinline: 1, rel: 0, iv_load_policy: 3, playsinline: 1 },
        events: {
          onReady: function () {
            playerReady = true;
            if (pendingCommand === 'play') player.playVideo();
            if (pendingCommand === 'pause') player.pauseVideo();
            pendingCommand = null;
            progressTimer = setInterval(function () {
              if (typeof player.getCurrentTime === 'function' && typeof player.getDuration === 'function') {
                window.parent.postMessage({ type: 'englizeka-video-progress', videoId: ${lessonId}, currentTime: player.getCurrentTime(), duration: player.getDuration() }, window.location.origin);
              }
            }, 500);
          },
          onStateChange: function (event) {
            var state = event.data === YT.PlayerState.PLAYING ? 'playing' : event.data === YT.PlayerState.PAUSED ? 'paused' : event.data === YT.PlayerState.ENDED ? 'ended' : 'other';
            window.parent.postMessage({ type: 'englizeka-video-state', videoId: ${lessonId}, state: state }, window.location.origin);
            if (event.data === YT.PlayerState.ENDED) {
              if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
              window.parent.postMessage({ type: 'englizeka-video-ended', videoId: ${lessonId} }, window.location.origin);
            }
          }
        }
      });
      window.addEventListener('message', function (event) {
        if (event.origin !== window.location.origin || !event.data || event.data.type !== 'englizeka-player-command') return;
        if (!playerReady) {
          pendingCommand = event.data.command;
          return;
        }
        if (event.data.command === 'play') player.playVideo();
        if (event.data.command === 'pause') player.pauseVideo();
        if (event.data.command === 'seek' && typeof event.data.value === 'string') {
          var seconds = Number(event.data.value);
          if (isFinite(seconds) && seconds >= 0) {
            var dur = player.getDuration() || 0;
            player.seekTo(Math.min(seconds, dur), true);
          }
        }
      });
    };
  </script>
</body>
</html>`;

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
