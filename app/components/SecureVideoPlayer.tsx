'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

type Video = {
  id: string;
  title: string;
  durationSeconds: number;
  completed: number;
  unlocked: number;
};

type ResolvedSource = {
  videoId: string;
  kind: 'upload' | 'youtube';
  sourceUrl: string;
  error?: string;
};

const QUALITY_LABELS: Record<string, string> = {
  highres: '4K+',
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};

export default function SecureVideoPlayer({
  videos,
  viewerEmail,
}: {
  videos: Video[];
  viewerEmail: string;
}) {
  const [lessons, setLessons] = useState(videos);
  const [activeId, setActiveId] = useState(
    videos.find((video) => video.unlocked)?.id || videos[0]?.id || ''
  );
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [resolveAttempt, setResolveAttempt] = useState(0);
  const [completionMessage, setCompletionMessage] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState('default');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionInFlight = useRef(new Set<string>());
  const active = lessons.find((video) => video.id === activeId);

  const [controlsVisible, setControlsVisible] = useState(true);

  const revealControls = useCallback((autoHide: boolean) => {
    if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    setControlsVisible(true);
    if (autoHide) {
      controlsHideTimer.current = setTimeout(() => setControlsVisible(false), 1800);
    }
  }, []);

  const sendYouTubeCommand = useCallback((command: string, value?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'englizeka-player-command', command, value },
      window.location.origin
    );
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await videoFrameRef.current?.requestFullscreen();
  }, []);

  const showSecurityOverlay = useCallback(() => {
    sendYouTubeCommand('pause');
    setSecurityMessage('تم إيقاف الفيديو بسبب مغادرة صفحة المشاهدة');
  }, [sendYouTubeCommand]);

  const completeLesson = useCallback(async (videoId: string) => {
    if (completionInFlight.current.has(videoId)) return;
    completionInFlight.current.add(videoId);
    try {
      const response = await fetch(`/api/videos/${videoId}/complete`, { method: 'POST' });
      if (!response.ok) return;
      setLessons((current) => {
        const completedIndex = current.findIndex((lesson) => lesson.id === videoId);
        return current.map((lesson, index) => ({
          ...lesson,
          completed: index === completedIndex ? 1 : lesson.completed,
          unlocked: index === completedIndex + 1 ? 1 : lesson.unlocked,
        }));
      });
      setCompletionMessage('تم إنهاء المحاضرة وفتح المحاضرة التالية بنجاح.');
    } finally {
      completionInFlight.current.delete(videoId);
    }
  }, []);

  useEffect(() => {
    if (!activeId || !active?.unlocked) return;
    const controller = new AbortController();
    void fetch(`/api/videos/${encodeURIComponent(activeId)}/resolve`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as {
          kind?: 'upload' | 'youtube';
          sourceUrl?: string;
          error?: string;
        };
        if (!response.ok || !result.kind || !result.sourceUrl) {
          throw new Error(result.error || 'تعذر تجهيز مصدر الفيديو');
        }
        setResolved({ videoId: activeId, kind: result.kind, sourceUrl: result.sourceUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResolved({
          videoId: activeId,
          kind: 'upload',
          sourceUrl: '',
          error: error instanceof Error ? error.message : 'تعذر تجهيز مصدر الفيديو',
        });
      });
    return () => controller.abort();
  }, [active?.unlocked, activeId, resolveAttempt]);

  useEffect(() => {
    const receivePlayerEvent = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        videoId?: string;
        state?: string;
        qualities?: string[];
        quality?: string;
      } | null;
      if (data?.type === 'englizeka-video-ended' && data.videoId === activeId) {
        setYoutubePlaying(false);
        void completeLesson(activeId);
      }
      if (data?.type === 'englizeka-video-state' && data.videoId === activeId) {
        const playing = data.state === 'playing';
        setYoutubePlaying(playing);
        revealControls(playing);
      }
      if (data?.type === 'englizeka-video-ready' && data.videoId === activeId) {
        setQualityLevels(Array.isArray(data.qualities) ? data.qualities : []);
        setSelectedQuality(data.quality || 'default');
      }
      if (data?.type === 'englizeka-video-quality' && data.videoId === activeId) {
        setSelectedQuality(data.quality || 'default');
      }
    };
    window.addEventListener('message', receivePlayerEvent);
    return () => window.removeEventListener('message', receivePlayerEvent);
  }, [activeId, completeLesson, revealControls]);

  useEffect(
    () => () => {
      if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    },
    []
  );

  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === videoFrameRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const protectOnVisibilityChange = () => {
      if (document.hidden && resolved?.videoId === activeId && resolved.kind === 'youtube') {
        showSecurityOverlay();
      }
    };
    document.addEventListener('visibilitychange', protectOnVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', protectOnVisibilityChange);
    };
  }, [activeId, resolved, showSecurityOverlay]);

  if (!lessons.length) {
    return (
      <div className="empty-course">
        <PlayCircle />
        <h2>المحتوى بيتجهز</h2>
        <p>سيتم إضافة فيديوهات الكورس هنا قريباً.</p>
      </div>
    );
  }

  const activeSource = resolved?.videoId === activeId ? resolved : null;

  return (
    <div className="learning-layout">
      <section className="secure-player-card">
        {active?.unlocked ? (
          <div
            ref={videoFrameRef}
            className={`video-frame ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`}
            onMouseMove={() => revealControls(youtubePlaying)}
            onMouseEnter={() => revealControls(youtubePlaying)}
            onMouseLeave={() => {
              if (youtubePlaying) revealControls(true);
            }}
            onTouchStart={() => revealControls(youtubePlaying)}
            onContextMenu={(event) => event.preventDefault()}
          >
            {!activeSource ? (
              <div className="video-source-state" role="status">
                <LoaderCircle className="spin" />
                <strong>جاري تجهيز الفيديو الآمن...</strong>
                <small>يتم التحقق من اشتراكك قبل تشغيل كل محاضرة.</small>
              </div>
            ) : activeSource.error ? (
              <div className="video-source-state" role="alert">
                <LockKeyhole />
                <strong>{activeSource.error}</strong>
                <button className="btn btn-outline" onClick={() => setResolveAttempt((v) => v + 1)}>
                  <RefreshCw /> إعادة المحاولة
                </button>
              </div>
            ) : activeSource.kind === 'youtube' ? (
              <iframe
                key={activeSource.sourceUrl}
                ref={iframeRef}
                className="youtube-player-host"
                src={activeSource.sourceUrl}
                title={active.title}
                allow="autoplay; encrypted-media"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                onLoad={() => sendYouTubeCommand('get-state')}
              />
            ) : (
              <video
                key={activeSource.sourceUrl}
                controls
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                disableRemotePlayback
                preload="metadata"
                src={activeSource.sourceUrl}
                onEnded={() => void completeLesson(active.id)}
                onContextMenu={(event) => event.preventDefault()}
              >
                متصفحك لا يدعم تشغيل الفيديو.
              </video>
            )}
            {activeSource?.kind === 'youtube' && !activeSource.error && (
              <>
                <div className="youtube-top-mask" aria-hidden="true" />
                <div
                  className="youtube-click-shield"
                  aria-label="تشغيل أو إيقاف الفيديو"
                  onClick={() => sendYouTubeCommand(youtubePlaying ? 'pause' : 'play')}
                  onContextMenu={(event) => event.preventDefault()}
                />
                <div
                  className={`englizeka-video-controls ${controlsVisible ? 'is-visible' : ''}`}
                  onFocus={() => revealControls(false)}
                  onBlur={() => revealControls(youtubePlaying)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <button
                    type="button"
                    aria-label={youtubePlaying ? 'إيقاف الفيديو مؤقتاً' : 'تشغيل الفيديو'}
                    onClick={() => sendYouTubeCommand(youtubePlaying ? 'pause' : 'play')}
                  >
                    {youtubePlaying ? <PauseCircle /> : <PlayCircle />}
                  </button>
                  <label>
                    <span>الجودة</span>
                    <select
                      aria-label="جودة الفيديو"
                      value={selectedQuality}
                      onChange={(event) => {
                        setSelectedQuality(event.target.value);
                        sendYouTubeCommand('quality', event.target.value);
                      }}
                    >
                      <option value="default">تلقائي</option>
                      {qualityLevels.map((quality) => (
                        <option key={quality} value={quality}>
                          {QUALITY_LABELS[quality] || quality}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
                    onClick={() => void toggleFullscreen()}
                  >
                    {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                  </button>
                </div>
              </>
            )}
            <div
              className="video-watermark video-watermark-top"
              aria-label={`المشاهد ${viewerEmail}`}
            >
              <UserRound /> {viewerEmail}
            </div>
            <div className="video-watermark video-watermark-trace" aria-hidden="true">
              {viewerEmail}
            </div>
            {securityMessage && (
              <div className="video-protection-overlay" role="alert" aria-live="assertive">
                <ShieldCheck />
                <h2>نظام المشاهدة الآمن</h2>
                <p>{securityMessage}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSecurityMessage('');
                    sendYouTubeCommand('play');
                  }}
                >
                  <PlayCircle /> العودة للمشاهدة
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="locked-lesson">
            <LockKeyhole />
            <h2>أكمل المحاضرة السابقة أولاً</h2>
            <p>شاهد المحاضرة السابقة حتى النهاية لفتح هذه المحاضرة تلقائياً.</p>
          </div>
        )}
        <div className="video-info">
          <div>
            <span className="section-label">المحاضرة الحالية</span>
            <h1>{active?.title}</h1>
          </div>
          <span className="secure-badge">
            <ShieldCheck /> مشاهدة محمية
          </span>
        </div>
        {completionMessage && (
          <div className="lesson-complete-message">
            <CheckCircle2 /> {completionMessage}
          </div>
        )}
        {active?.unlocked && (
          <div className="video-security-note">
            <LockKeyhole /> هوية الطالب ظاهرة فوق الفيديو لتتبع أي تسجيل أو مشاركة غير مصرح بها.
          </div>
        )}
      </section>
      <aside className="lesson-sidebar">
        <h2>محتوى الكورس</h2>
        <div>
          {lessons.map((video, index) => (
            <button
              key={video.id}
              className={`${video.id === activeId ? 'active' : ''} ${video.unlocked ? '' : 'locked'}`}
              onClick={() => {
                setActiveId(video.id);
                setCompletionMessage('');
                setSecurityMessage('');
                setYoutubePlaying(false);
                setQualityLevels([]);
                setSelectedQuality('default');
              }}
            >
              <span>{index + 1}</span>
              <div>
                <strong>{video.title}</strong>
                <small>
                  {video.completed
                    ? 'تمت المشاهدة'
                    : video.unlocked
                      ? video.durationSeconds
                        ? `${Math.ceil(video.durationSeconds / 60)} دقيقة`
                        : 'جاهزة للمشاهدة'
                      : 'أكمل المحاضرة السابقة'}
                </small>
              </div>
              {video.completed ? (
                <CheckCircle2 />
              ) : video.unlocked ? (
                <PlayCircle />
              ) : (
                <LockKeyhole />
              )}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
