'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LockKeyhole, PlayCircle, ShieldCheck, UserRound } from 'lucide-react';

type Video = {
  id: string;
  title: string;
  durationSeconds: number;
  completed: number;
  unlocked: number;
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
  const [completionMessage, setCompletionMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = lessons.find((video) => video.id === activeId);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    setCompletionMessage('');
  }, [activeId]);

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
        <p>سيتم إضافة فيديوهات الكورس هنا قريبًا.</p>
      </div>
    );

  return (
    <div className="learning-layout">
      <section className="secure-player-card">
        {active?.unlocked ? (
          <div className="video-frame" onContextMenu={(event) => event.preventDefault()}>
            <video
              ref={videoRef}
              controls
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              preload="metadata"
              src={`/api/videos/${activeId}`}
              onEnded={() => void completeLesson(active.id)}
              onContextMenu={(event) => event.preventDefault()}
            >
              متصفحك لا يدعم تشغيل الفيديو.
            </video>
            <div
              className="video-watermark video-watermark-top"
              aria-label={`المشاهد ${viewerEmail}`}
            >
              <UserRound /> {viewerEmail}
            </div>
          </div>
        ) : (
          <div className="locked-lesson">
            <LockKeyhole />
            <h2>أكمل المحاضرة السابقة أولًا</h2>
            <p>شاهد المحاضرة السابقة حتى النهاية لفتح هذه المحاضرة تلقائيًا.</p>
          </div>
        )}
        <div className="video-info">
          <div>
            <span className="section-label">المحاضرة الحالية</span>
            <h1>{active?.title}</h1>
          </div>
          <span className="secure-badge">
            <ShieldCheck /> بث مؤمّن
          </span>
        </div>
        {completionMessage && (
          <div className="lesson-complete-message">
            <CheckCircle2 /> {completionMessage}
          </div>
        )}
        {active?.unlocked && (
          <div className="video-security-note">
            <LockKeyhole /> اسم حساب الطالب ظاهر أعلى الفيديو لحماية المحتوى وتحديد صاحب التسجيل.
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
              onClick={() => setActiveId(video.id)}
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
