'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Pause,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

const QUALITY_LABELS: Record<string, string> = {
  highres: '1080p+ (عالية جداً)',
  hd1080: '1080p (عالية)',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
  auto: 'تلقائي (تكيفي)',
  default: 'تلقائي (تكيفي)',
};

export type PrerequisiteExam = {
  id: string;
  title: string;
  minimumScore: number;
  bestPercentage: number | null;
  passed: boolean;
};

export type Video = {
  id: string;
  title: string;
  durationSeconds: number;
  completed: number;
  unlocked: number;
  prerequisiteExam?: PrerequisiteExam | null;
  lockReason?: 'previous_lesson' | 'prerequisite_exam' | null;
  maxViews?: number;
  usedViews?: number;
  remainingViews?: number | null;
};

type ResolvedSource = {
  videoId: string;
  kind: 'youtube';
  sourceUrl: string;
  completionToken: string;
  error?: string;
};

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SecureVideoPlayer({
  videos,
  viewerEmail,
  initialVideoId,
  allowSequentialUnlock = true,
}: {
  videos: Video[];
  viewerEmail: string;
  initialVideoId?: string;
  allowSequentialUnlock?: boolean;
}) {
  const [lessons, setLessons] = useState(videos);
  const [activeId, setActiveId] = useState(
    videos.find((video) => video.id === initialVideoId && video.unlocked)?.id ||
      videos.find((video) => video.unlocked)?.id ||
      videos[0]?.id ||
      ''
  );
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [resolveAttempt, setResolveAttempt] = useState(0);
  const [completionMessage, setCompletionMessage] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [hasEnded, setHasEnded] = useState(false);
  const [centerFeedback, setCenterFeedback] = useState<{ type: 'play' | 'pause'; id: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [availableRates, setAvailableRates] = useState<number[]>([0.75, 1, 1.25, 1.5, 2]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionInFlight = useRef(new Set<string>());
  const scrubbingRef = useRef(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const active = lessons.find((video) => video.id === activeId);

  // ─── View Session State ──────────────────────────────────────────────────────
  const viewSessionRef = useRef<{ sessionId: string; expiresAt: number } | null>(null);
  const viewHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewStartedRef = useRef(false);

  const [controlsVisible, setControlsVisible] = useState(true);

  const revealControls = useCallback((autoHide: boolean) => {
    if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    setControlsVisible(true);
    if (autoHide) {
      controlsHideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
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

  const completeLesson = useCallback(
    async (videoId: string) => {
      if (completionInFlight.current.has(videoId)) return;
      const completionToken = resolved?.videoId === videoId ? resolved.completionToken : undefined;
      if (!completionToken) return;
      completionInFlight.current.add(videoId);
      try {
        const response = await fetch(`/api/videos/${videoId}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completionToken }),
        });
        if (!response.ok) return;
        setLessons((current) => {
          const completedIndex = current.findIndex((lesson) => lesson.id === videoId);
          return current.map((lesson, index) => {
            if (index === completedIndex) {
              return { ...lesson, completed: 1 };
            }
            if (allowSequentialUnlock && index === completedIndex + 1) {
              const examPassed = !lesson.prerequisiteExam || lesson.prerequisiteExam.passed;
              return {
                ...lesson,
                unlocked: examPassed ? 1 : 0,
                lockReason: !examPassed ? 'prerequisite_exam' : null,
              };
            }
            return lesson;
          });
        });
        setCompletionMessage('تم إنهاء المحاضرة وفتح المحاضرة التالية بنجاح.');
      } finally {
        completionInFlight.current.delete(videoId);
      }
    },
    [allowSequentialUnlock, resolved]
  );

  // ─── View Session: Start ─────────────────────────────────────────────────────
  const startViewSession = useCallback(async (videoId: string) => {
    if (viewStartedRef.current) return;
    viewStartedRef.current = true;
    try {
      const response = await fetch(`/api/student/videos/${encodeURIComponent(videoId)}/view-session/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 403) {
          setSecurityMessage(errorData.error || 'لقد استنفدت عدد المشاهدات المسموحة لهذه المحاضرة');
          setYoutubePlaying(false);
          setLessons((prev) =>
            prev.map((item) =>
              item.id === videoId
                ? {
                    ...item,
                    remainingViews: 0,
                    usedViews:
                      typeof item.maxViews === 'number' && item.maxViews > 0
                        ? item.maxViews
                        : item.usedViews,
                  }
                : item
            )
          );
        }
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        expiresAt?: number;
        viewsRemaining?: number | null;
      };
      if (data.sessionId && data.expiresAt) {
        viewSessionRef.current = { sessionId: data.sessionId, expiresAt: data.expiresAt };
      }
      if (typeof data.viewsRemaining === 'number') {
        const remaining = data.viewsRemaining;
        setLessons((prev) =>
          prev.map((item) =>
            item.id === videoId
              ? {
                  ...item,
                  remainingViews: remaining,
                  usedViews:
                    typeof item.maxViews === 'number' && item.maxViews > 0
                      ? Math.max(item.maxViews - remaining, 0)
                      : item.usedViews,
                }
              : item
          )
        );
      }
    } catch {
      // Non-critical — continue playing
    }
  }, []);

  // ─── View Session: Heartbeat ─────────────────────────────────────────────────
  const startHeartbeat = useCallback(() => {
    if (viewHeartbeatRef.current) return;
    viewHeartbeatRef.current = setInterval(async () => {
      const session = viewSessionRef.current;
      if (!session || Date.now() >= session.expiresAt) {
        if (viewHeartbeatRef.current) clearInterval(viewHeartbeatRef.current);
        viewHeartbeatRef.current = null;
        return;
      }
      try {
        await fetch(`/api/student/videos/${encodeURIComponent(activeId)}/view-session/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
      } catch {
        // Non-critical
      }
    }, 30_000);
  }, [activeId]);

  const stopHeartbeat = useCallback(() => {
    if (viewHeartbeatRef.current) {
      clearInterval(viewHeartbeatRef.current);
      viewHeartbeatRef.current = null;
    }
  }, []);

  // Cleanup heartbeat on unmount or video change
  useEffect(() => {
    return () => {
      stopHeartbeat();
      viewStartedRef.current = false;
      viewSessionRef.current = null;
    };
  }, [activeId, stopHeartbeat]);

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
          kind?: 'youtube';
          sourceUrl?: string;
          completionToken?: string;
          error?: string;
        };
        if (!response.ok || !result.kind || !result.sourceUrl || !result.completionToken) {
          throw new Error(result.error || 'تعذر تجهيز مصدر الفيديو');
        }
        setResolved({
          videoId: activeId,
          kind: result.kind,
          sourceUrl: result.sourceUrl,
          completionToken: result.completionToken,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResolved({
          videoId: activeId,
          kind: 'youtube',
          sourceUrl: '',
          completionToken: '',
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
        currentTime?: number;
        duration?: number;
      } | null;
      if (!data) return;
      if (data.videoId !== activeId) return;

      if (data.type === 'englizeka-video-info') {
        const info = data as {
          qualities?: string[];
          quality?: string;
          rates?: number[];
          rate?: number;
        };
        if (Array.isArray(info.qualities) && info.qualities.length > 0) {
          setAvailableQualities(info.qualities);
        }
        if (typeof info.quality === 'string' && info.quality) {
          setSelectedQuality(info.quality);
        }
        if (Array.isArray(info.rates) && info.rates.length > 0) {
          setAvailableRates(info.rates);
        }
        if (typeof info.rate === 'number' && info.rate > 0) {
          setPlaybackSpeed(info.rate);
        }
      }
      if (data.type === 'englizeka-video-ended') {
        setYoutubePlaying(false);
        setHasEnded(true);
        stopHeartbeat();
        void completeLesson(activeId);
      }
      if (data.type === 'englizeka-video-state') {
        const playing = data.state === 'playing';
        setYoutubePlaying(playing);
        if (playing) setHasEnded(false);
        revealControls(playing);
        if (playing) {
          void startViewSession(activeId);
          startHeartbeat();
        } else {
          stopHeartbeat();
        }
      }
      if (data.type === 'englizeka-video-quality') {
        const qData = data as { quality?: string };
        if (typeof qData.quality === 'string') setSelectedQuality(qData.quality);
      }
      if (data.type === 'englizeka-video-rate') {
        const rData = data as { rate?: number };
        if (typeof rData.rate === 'number') setPlaybackSpeed(rData.rate);
      }
      if (data.type === 'englizeka-video-progress') {
        if (!scrubbingRef.current) {
          setCurrentTime(typeof data.currentTime === 'number' ? data.currentTime : 0);
          setDuration(typeof data.duration === 'number' ? data.duration : 0);
        }
      }
    };
    window.addEventListener('message', receivePlayerEvent);
    return () => window.removeEventListener('message', receivePlayerEvent);
  }, [activeId, completeLesson, revealControls, startViewSession, startHeartbeat, stopHeartbeat]);

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
        stopHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', protectOnVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', protectOnVisibilityChange);
    };
  }, [activeId, resolved, showSecurityOverlay, stopHeartbeat]);

  const seekTo = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, duration || 0));
      sendYouTubeCommand('seek', String(clamped));
      setCurrentTime(clamped);
    },
    [duration, sendYouTubeCommand]
  );

  const handleSliderInteraction = useCallback(
    (clientX: number) => {
      if (!sliderRef.current || duration <= 0) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const handleSliderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (duration <= 0) return;
      scrubbingRef.current = true;
      setIsScrubbing(true);
      const seconds = handleSliderInteraction(e.clientX);
      if (seconds !== undefined) setScrubPosition(seconds);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [duration, handleSliderInteraction]
  );

  const handleSliderPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubbingRef.current) return;
      const seconds = handleSliderInteraction(e.clientX);
      if (seconds !== undefined) setScrubPosition(seconds);
    },
    [handleSliderInteraction]
  );

  const handleSliderPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubbingRef.current) return;
      scrubbingRef.current = false;
      setIsScrubbing(false);
      const seconds = handleSliderInteraction(e.clientX);
      if (seconds !== undefined) seekTo(seconds);
    },
    [handleSliderInteraction, seekTo]
  );

  const triggerCenterFeedback = useCallback((type: 'play' | 'pause') => {
    setCenterFeedback({ type, id: Date.now() });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      setCenterFeedback(null);
    }, 700);
  }, []);

  const handleSurfaceClick = useCallback(() => {
    if (hasEnded) {
      setHasEnded(false);
      seekTo(0);
      sendYouTubeCommand('play');
      triggerCenterFeedback('play');
      revealControls(true);
      return;
    }
    if (youtubePlaying) {
      sendYouTubeCommand('pause');
      triggerCenterFeedback('pause');
      revealControls(false);
    } else {
      sendYouTubeCommand('play');
      triggerCenterFeedback('play');
      revealControls(true);
    }
  }, [hasEnded, youtubePlaying, seekTo, sendYouTubeCommand, triggerCenterFeedback, revealControls]);

  const displayTime = isScrubbing ? scrubPosition : currentTime;
  const progressPercent = duration > 0 ? (displayTime / duration) * 100 : 0;

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
            <div className="video-stage">
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
                  <button
                    className="btn btn-outline"
                    onClick={() => setResolveAttempt((v) => v + 1)}
                  >
                    <RefreshCw /> إعادة المحاولة
                  </button>
                </div>
              ) : (
                <>
                  <iframe
                    key={activeSource.sourceUrl}
                    ref={iframeRef}
                    className="youtube-player-host"
                    src={activeSource.sourceUrl}
                    title={active.title}
                    allow="autoplay; encrypted-media"
                    referrerPolicy="strict-origin-when-cross-origin"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                  />
                  {/* Click/tap surface layer covering visible video */}
                  <div
                    className="video-surface-click-layer"
                    role="button"
                    tabIndex={0}
                    aria-label={hasEnded ? 'إعادة تشغيل المحاضرة' : youtubePlaying ? 'إيقاف الفيديو مؤقتاً' : 'تشغيل الفيديو'}
                    onClick={handleSurfaceClick}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        handleSurfaceClick();
                      }
                    }}
                  >
                    {/* Ended / Replay state */}
                    {hasEnded && (
                      <div className="video-center-ended-badge" aria-hidden="true">
                        <RotateCcw size={32} />
                        <span>إعادة تشغيل المحاضرة</span>
                      </div>
                    )}

                    {/* Paused state overlay */}
                    {!hasEnded && !youtubePlaying && !centerFeedback && (
                      <div className="video-center-paused-badge" aria-hidden="true">
                        <Play size={36} />
                      </div>
                    )}

                    {/* Transient feedback icon */}
                    {centerFeedback && (
                      <div key={centerFeedback.id} className="video-center-feedback animate-feedback" aria-hidden="true">
                        {centerFeedback.type === 'play' ? <Play size={42} /> : <Pause size={42} />}
                      </div>
                    )}
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
                  {active?.remainingViews !== 0 && (
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
                  )}
                </div>
              )}
            </div>
            {activeSource?.kind === 'youtube' && !activeSource.error && (
              <div
                className={`englizeka-video-controls ${controlsVisible ? 'is-visible' : ''}`}
                dir="ltr"
                onClick={(e) => e.stopPropagation()}
                onFocus={() => revealControls(false)}
                onBlur={() => revealControls(youtubePlaying)}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  className="video-ctrl-btn video-ctrl-play"
                  aria-label={hasEnded ? 'إعادة تشغيل المحاضرة' : youtubePlaying ? 'إيقاف الفيديو مؤقتًا' : 'تشغيل الفيديو'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hasEnded) {
                      setHasEnded(false);
                      seekTo(0);
                    }
                    sendYouTubeCommand(youtubePlaying ? 'pause' : 'play');
                  }}
                >
                  {hasEnded ? <RotateCcw /> : youtubePlaying ? <PauseCircle /> : <PlayCircle />}
                </button>
                <button
                  type="button"
                  className="video-ctrl-btn"
                  aria-label="رجوع 10 ثوانٍ"
                  onClick={(e) => {
                    e.stopPropagation();
                    seekTo(currentTime - 10);
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 17a1 1 0 0 1-1-1v-4l-5 3V9l5 3V8a1 1 0 0 1 1.5-.86l6 4a1 1 0 0 1 0 1.72l-6 4A1 1 0 0 1 11 17z" transform="scale(-1,1) translate(-24,0)"/><text x="5" y="16" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
                </button>
                <button
                  type="button"
                  className="video-ctrl-btn"
                  aria-label="تقديم 10 ثوانٍ"
                  onClick={(e) => {
                    e.stopPropagation();
                    seekTo(currentTime + 10);
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 17a1 1 0 0 0 1-1v-4l5 3V9l-5 3V8a1 1 0 0 0-1.5-.86l-6 4a1 1 0 0 0 0 1.72l6 4A1 1 0 0 0 13 17z"/><text x="10" y="16" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
                </button>
                <span className="video-time-label" dir="ltr">{formatTime(displayTime)}</span>
                <div
                  ref={sliderRef}
                  className={`video-seek-slider ${isScrubbing ? 'scrubbing' : ''}`}
                  role="slider"
                  aria-label="تقديم أو رجوع الفيديو"
                  aria-valuemin={0}
                  aria-valuemax={Math.floor(duration)}
                  aria-valuenow={Math.floor(displayTime)}
                  tabIndex={0}
                  dir="ltr"
                  onPointerDown={handleSliderPointerDown}
                  onPointerMove={handleSliderPointerMove}
                  onPointerUp={handleSliderPointerUp}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') seekTo(currentTime + 5);
                    if (e.key === 'ArrowLeft') seekTo(currentTime - 5);
                  }}
                >
                  <div className="video-seek-track">
                    <div className="video-seek-filled" style={{ left: 0, width: `${progressPercent}%` }} />
                    <div className="video-seek-thumb" style={{ left: `${progressPercent}%` }} />
                  </div>
                </div>
                <span className="video-time-label" dir="ltr">{formatTime(duration)}</span>

                {/* Settings / Quality & Speed Menu */}
                <div className="video-settings-wrapper" style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`video-ctrl-btn video-ctrl-settings ${showSettings ? 'is-active' : ''}`}
                    aria-label="إعدادات الفيديو والجودة"
                    title="الإعدادات والجودة"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSettings((prev) => !prev);
                    }}
                  >
                    <Settings size={18} />
                  </button>
                  {showSettings && (
                    <div
                      className="video-settings-popover"
                      dir="rtl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="video-settings-header">
                        <span>إعدادات التشغيل</span>
                        <button
                          type="button"
                          className="video-settings-close"
                          onClick={() => setShowSettings(false)}
                          aria-label="إغلاق"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="video-settings-section">
                        <span className="video-settings-title">سرعة التشغيل</span>
                        <div className="video-settings-chips" dir="ltr">
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              type="button"
                              className={`video-chip ${playbackSpeed === rate ? 'is-selected' : ''}`}
                              onClick={() => {
                                setPlaybackSpeed(rate);
                                sendYouTubeCommand('speed', String(rate));
                              }}
                            >
                              {rate === 1 ? '1x (عادي)' : `${rate}x`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="video-settings-section">
                        <span className="video-settings-title">جودة الفيديو</span>
                        <div className="video-settings-list">
                          <button
                            type="button"
                            className={`video-quality-item ${selectedQuality === 'auto' || selectedQuality === 'default' ? 'is-selected' : ''}`}
                            onClick={() => {
                              setSelectedQuality('auto');
                              sendYouTubeCommand('quality', 'default');
                            }}
                          >
                            <span>تلقائي (تكيفي حسب السرعة)</span>
                            {(selectedQuality === 'auto' || selectedQuality === 'default') && (
                              <span className="quality-check">✓</span>
                            )}
                          </button>
                          {availableQualities
                            .filter((q) => q !== 'auto' && q !== 'default')
                            .map((q) => (
                              <button
                                key={q}
                                type="button"
                                className={`video-quality-item ${selectedQuality === q ? 'is-selected' : ''}`}
                                onClick={() => {
                                  setSelectedQuality(q);
                                  sendYouTubeCommand('quality', q);
                                }}
                              >
                                <span>{QUALITY_LABELS[q] || q}</span>
                                {selectedQuality === q && <span className="quality-check">✓</span>}
                              </button>
                            ))}
                        </div>
                        <p className="video-settings-hint">
                          يتم تكييف البث تلقائيًا حسب سرعة اتصالك بالإنترنت لضمان المشاهدة بدون تقطيع.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="video-ctrl-btn video-ctrl-fullscreen"
                  aria-label={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFullscreen();
                  }}
                >
                  {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                </button>
              </div>
            )}
          </div>
        ) : active?.lockReason === 'prerequisite_exam' && active?.prerequisiteExam ? (
          <div className="locked-lesson" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <Award size={48} style={{ color: 'var(--primary, #e11d48)', margin: '0 auto 1rem' }} />
            <h2 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem' }}>امتحان مطلوب لفتح هذه المحاضرة</h2>
            <p style={{ maxWidth: '500px', margin: '0 auto 0.75rem', color: 'var(--text-secondary)' }}>
              يجب اجتياز <strong>{active.prerequisiteExam.title}</strong> بنسبة{' '}
              <strong>{active.prerequisiteExam.minimumScore}%</strong> على الأقل لتتمكن من مشاهدة هذه المحاضرة.
            </p>
            {active.prerequisiteExam.bestPercentage !== null && (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '1.25rem' }}>
                أعلى نتيجة حققتها حتى الآن:{' '}
                <span
                  style={{
                    color: active.prerequisiteExam.passed ? '#10b981' : '#ef4444',
                    fontWeight: 700,
                  }}
                >
                  {active.prerequisiteExam.bestPercentage}%
                </span>
              </p>
            )}
            <Link
              href={`/exam/${active.prerequisiteExam.id}`}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem auto 0' }}
            >
              <ClipboardCheck size={16} /> دخول الامتحان الآن
            </Link>
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
          <div className="video-badges">
            {typeof active?.maxViews === 'number' && active.maxViews > 0 ? (
              active.remainingViews === 0 ? (
                <span className="view-limit-badge is-exhausted" title="تم استهلاك جميع مرات المشاهدة">
                  <EyeOff /> تم استخدام جميع مرات المشاهدة
                </span>
              ) : active.remainingViews === 1 ? (
                <span className="view-limit-badge is-warning" title="المشاهدة الأخيرة المتبقية">
                  <Eye /> متبقي لك مشاهدة واحدة
                </span>
              ) : (
                <span className="view-limit-badge is-ok" title={`متبقي لك ${active.remainingViews} من ${active.maxViews} مشاهدات`}>
                  <Eye /> متبقي لك {active.remainingViews} من {active.maxViews} مشاهدات
                </span>
              )
            ) : active ? (
              <span className="view-limit-badge is-unlimited" title="مشاهدة غير محدودة">
                <Eye /> مشاهدة غير محدودة
              </span>
            ) : null}
            <span className="secure-badge">
              <ShieldCheck /> مشاهدة محمية
            </span>
          </div>
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
            <div key={video.id} className="curriculum-item-group" style={{ marginBottom: '0.5rem' }}>
              {video.prerequisiteExam && (
                <div
                  className="curriculum-exam-card"
                  style={{
                    background: video.prerequisiteExam.passed
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(239, 68, 68, 0.08)',
                    border: `1px solid ${
                      video.prerequisiteExam.passed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }`,
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    marginBottom: '0.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: video.prerequisiteExam.passed ? '#10b981' : '#ef4444',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      <ClipboardCheck size={14} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {video.prerequisiteExam.title}
                      </div>
                      <small style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block' }}>
                        {video.prerequisiteExam.passed
                          ? `✓ تم الاجتياز بنجاح (${video.prerequisiteExam.bestPercentage}%)`
                          : `مطلوب ${video.prerequisiteExam.minimumScore}% لفتح المحاضرة`}
                      </small>
                    </div>
                  </div>
                  <Link
                    href={`/exam/${video.prerequisiteExam.id}`}
                    className={`btn btn-sm ${video.prerequisiteExam.passed ? 'btn-outline' : 'btn-primary'}`}
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', flexShrink: 0 }}
                  >
                    {video.prerequisiteExam.passed ? 'مراجعة' : 'دخول الاختبار'}
                  </Link>
                </div>
              )}

              <button
                type="button"
                className={`${video.id === activeId ? 'active' : ''} ${video.unlocked ? '' : 'locked'}`}
                onClick={() => {
                  setActiveId(video.id);
                  setCompletionMessage('');
                  setSecurityMessage('');
                  setYoutubePlaying(false);
                  setHasEnded(false);
                  setCenterFeedback(null);
                  setShowSettings(false);
                  setCurrentTime(0);
                  setDuration(0);
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
                        : video.lockReason === 'prerequisite_exam'
                          ? `مطلوب اجتياز: ${video.prerequisiteExam?.title}`
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
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
