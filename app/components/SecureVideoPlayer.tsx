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
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';

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
  youtubeId?: string | null;
  sourceUrl: string;
  completionToken: string;
  error?: string;
  isUnauthorized?: boolean;
};

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

  const playerRef = useRef<MediaPlayerInstance>(null);
  const completionInFlight = useRef(new Set<string>());
  const active = lessons.find((video) => video.id === activeId);

  // ─── View Session State ──────────────────────────────────────────────────────
  const viewSessionRef = useRef<{ sessionId: string; expiresAt: number } | null>(null);
  const viewHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewStartedRef = useRef(false);

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
          playerRef.current?.pause();
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

  // Reset state when active video changes
  useEffect(() => {
    setSecurityMessage('');
    setYoutubePlaying(false);
  }, [activeId]);

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
          youtubeId?: string | null;
          sourceUrl?: string;
          completionToken?: string;
          error?: string;
        };
        if (!response.ok) {
          const isUnauthorized = response.status === 401 || response.status === 403;
          const errorMsg =
            result.error || (isUnauthorized ? 'غير مصرح بالدخول' : 'تعذر تجهيز مصدر الفيديو');
          setResolved({
            videoId: activeId,
            kind: 'youtube',
            sourceUrl: '',
            completionToken: '',
            error: errorMsg,
            isUnauthorized,
          });
          return;
        }
        if (!result.sourceUrl || !result.completionToken) {
          throw new Error(result.error || 'تعذر تجهيز مصدر الفيديو');
        }
        setResolved({
          videoId: activeId,
          kind: result.kind || 'youtube',
          youtubeId: result.youtubeId || null,
          sourceUrl: result.sourceUrl,
          completionToken: result.completionToken,
          isUnauthorized: false,
        });
        setSecurityMessage('');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResolved({
          videoId: activeId,
          kind: 'youtube',
          sourceUrl: '',
          completionToken: '',
          error: error instanceof Error ? error.message : 'تعذر تجهيز مصدر الفيديو',
          isUnauthorized: false,
        });
      });
    return () => controller.abort();
  }, [active?.unlocked, activeId, resolveAttempt]);

  // Media Player Callbacks
  const handlePlaying = useCallback(() => {
    setYoutubePlaying(true);
    void startViewSession(activeId);
    startHeartbeat();
  }, [activeId, startViewSession, startHeartbeat]);

  const handlePause = useCallback(() => {
    setYoutubePlaying(false);
    stopHeartbeat();
  }, [stopHeartbeat]);

  const handleEnded = useCallback(() => {
    setYoutubePlaying(false);
    stopHeartbeat();
    void completeLesson(activeId);
  }, [activeId, completeLesson, stopHeartbeat]);

  const handleError = useCallback(() => {
    setYoutubePlaying(false);
    stopHeartbeat();
  }, [stopHeartbeat]);

  const handleFullscreenChange = useCallback((isFullscreen: boolean) => {
    if (typeof document !== 'undefined') {
      if (isFullscreen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  }, []);

  useEffect(() => {
    const protectOnVisibilityChange = () => {
      if (document.hidden && youtubePlaying) {
        playerRef.current?.pause();
        setSecurityMessage('تم إيقاف الفيديو بسبب مغادرة صفحة المشاهدة');
        stopHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', protectOnVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', protectOnVisibilityChange);
    };
  }, [youtubePlaying, stopHeartbeat]);

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
          <div className="video-player-container">
            {!activeSource ? (
              <div className="video-source-state" role="status">
                <LoaderCircle className="spin" />
                <strong>جاري تجهيز الفيديو...</strong>
                <small>لحظات ويتم تشغيل المحاضرة</small>
              </div>
            ) : activeSource.error ? (
              <div className="video-source-state" role="alert">
                <LockKeyhole />
                <strong>{activeSource.error}</strong>
                {activeSource.isUnauthorized ? (
                  <small>يرجى التأكد من صلاحية الاشتراك أو الكود المستخدم.</small>
                ) : (
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setSecurityMessage('');
                      setResolveAttempt((v) => v + 1);
                    }}
                  >
                    <RefreshCw /> إعادة المحاولة
                  </button>
                )}
              </div>
            ) : activeSource.youtubeId ? (
              <MediaPlayer
                ref={playerRef}
                key={activeSource.videoId}
                title={active.title}
                src={`youtube/${activeSource.youtubeId}`}
                aspectRatio="16/9"
                playsInline
                onPlaying={handlePlaying}
                onPause={handlePause}
                onEnd={handleEnded}
                onError={handleError}
                onFullscreenChange={handleFullscreenChange}
                className="englizeka-vidstack-player"
              >
                <MediaProvider />
                <div
                  className="video-watermark video-watermark-top"
                  aria-label={`المشاهد ${viewerEmail}`}
                >
                  <UserRound size={13} /> {viewerEmail}
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
                          playerRef.current?.play();
                        }}
                      >
                        <PlayCircle /> العودة للمشاهدة
                      </button>
                    )}
                  </div>
                )}
                <DefaultVideoLayout icons={defaultLayoutIcons} colorScheme="dark" />
              </MediaPlayer>
            ) : (
              <div className="video-source-state" role="alert">
                <LockKeyhole />
                <strong>مصدر الفيديو غير متوفر</strong>
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
