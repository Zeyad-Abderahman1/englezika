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
  <style>html,body,#player{width:100%;height:100%;margin:0;background:#000;overflow:hidden}</style>
</head>
<body oncontextmenu="return false">
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    window.onYouTubeIframeAPIReady = function () {
      var playerReady = false;
      var pendingCommand = null;
      var player = new YT.Player('player', {
        videoId: ${youtubeId},
        playerVars: { controls: 1, cc_load_policy: 0, disablekb: 0, fs: 1, modestbranding: 1, origin: ${embedOrigin}, playsinline: 1, rel: 0 },
        events: {
          onReady: function () {
            playerReady = true;
            window.parent.postMessage({ type: 'englizeka-video-ready', videoId: ${lessonId}, qualities: player.getAvailableQualityLevels(), quality: player.getPlaybackQuality() || 'default' }, window.location.origin);
            if (pendingCommand === 'play') player.playVideo();
            if (pendingCommand === 'pause') player.pauseVideo();
            pendingCommand = null;
          },
          onStateChange: function (event) {
            var state = event.data === YT.PlayerState.PLAYING ? 'playing' : event.data === YT.PlayerState.PAUSED ? 'paused' : event.data === YT.PlayerState.ENDED ? 'ended' : 'other';
            window.parent.postMessage({ type: 'englizeka-video-state', videoId: ${lessonId}, state: state }, window.location.origin);
            if (event.data === YT.PlayerState.PLAYING) {
              window.parent.postMessage({ type: 'englizeka-video-ready', videoId: ${lessonId}, qualities: player.getAvailableQualityLevels(), quality: player.getPlaybackQuality() || 'default' }, window.location.origin);
            }
            if (event.data === YT.PlayerState.ENDED) {
              window.parent.postMessage({ type: 'englizeka-video-ended', videoId: ${lessonId} }, window.location.origin);
            }
          },
          onPlaybackQualityChange: function (event) {
            window.parent.postMessage({ type: 'englizeka-video-quality', videoId: ${lessonId}, quality: event.data || 'default' }, window.location.origin);
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
        if (event.data.command === 'quality' && typeof event.data.value === 'string') player.setPlaybackQuality(event.data.value);
        if (event.data.command === 'get-state') window.parent.postMessage({ type: 'englizeka-video-ready', videoId: ${lessonId}, qualities: player.getAvailableQualityLevels(), quality: player.getPlaybackQuality() || 'default' }, window.location.origin);
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
