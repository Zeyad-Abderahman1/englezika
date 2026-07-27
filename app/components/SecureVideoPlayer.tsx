'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LockKeyhole, PlayCircle, ShieldCheck, UserRound } from 'lucide-react';

type Video = {
  id: string;
  title: string;
  durationSeconds: number;
  sourceType: string;
  youtubeId: string | null;
  completed: number;
  unlocked: number;
};

type YouTubePlayerInstance = { destroy: () => void };
type YouTubeStateEvent = { data: number };

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          playerVars: Record<string, number>;
          events: { onStateChange: (event: YouTubeStateEvent) => void };
        }
      ) => YouTubePlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<void>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

function YouTubeLesson({ videoId, onEnded }: { videoId: string; onEnded: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let disposed = false;
    let player: YouTubePlayerInstance | null = null;
    void loadYouTubeApi().then(() => {
      if (disposed || !hostRef.current || !window.YT?.Player) return;
      player = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          disablekb: 1,
          fs: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onStateChange: (event) => {
            if (event.data === 0) onEndedRef.current();
          },
        },
      });
    });
    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [videoId]);

  return <div ref={hostRef} className="youtube-player-host" />;
}

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
  const [completionMessage, setCompletionMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = lessons.find((video) => video.id === activeId);

  async function completeLesson(videoId: string) {
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
  }

  if (!lessons.length)
    return (
      <div className="empty-course">
        <PlayCircle />
        <h2>المحتوى بيتجهز</h2>
        <p>سيتم إضافة فيديوهات الكورس هنا قريباً.</p>
      </div>
    );

  const isYouTube = active?.sourceType === 'youtube' && Boolean(active.youtubeId);

  return (
    <div className="learning-layout">
      <section className="secure-player-card">
        {active?.unlocked ? (
          <div className="video-frame" onContextMenu={(event) => event.preventDefault()}>
            {isYouTube && active.youtubeId ? (
              <YouTubeLesson
                key={active.id}
                videoId={active.youtubeId}
                onEnded={() => void completeLesson(active.id)}
              />
            ) : (
              <video
                ref={videoRef}
                controls
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                disableRemotePlayback
                preload="metadata"
                src={`/api/videos/${activeId}`}
                onEnded={() => void completeLesson(active.id)}
                onContextMenu={(event) => event.preventDefault()}
              >
                متصفحك لا يدعم تشغيل الفيديو.
              </video>
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
