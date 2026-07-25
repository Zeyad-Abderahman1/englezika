"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileQuestion, LockKeyhole, PlayCircle, ShieldCheck } from "lucide-react";

type Video = {
  id: string;
  title: string;
  durationSeconds: number;
  prerequisiteExamId: string | null;
  prerequisiteExamTitle: string | null;
  minimumScore: number;
  unlocked: number;
};

export default function SecureVideoPlayer({ videos, viewerEmail }: { videos: Video[]; viewerEmail: string }) {
  const [activeId, setActiveId] = useState(videos.find((video) => video.unlocked)?.id || videos[0]?.id || "");
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = videos.find((video) => video.id === activeId);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
  }, [activeId]);

  if (!videos.length) return <div className="empty-course"><PlayCircle /><h2>المحتوى بيتجهز</h2><p>سيتم إضافة فيديوهات الكورس هنا قريباً.</p></div>;

  return (
    <div className="learning-layout">
      <section className="secure-player-card">
        {active?.unlocked ? <div className="video-frame" onContextMenu={(event) => event.preventDefault()}>
          <video
            ref={videoRef}
            controls
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            preload="metadata"
            src={`/api/videos/${activeId}`}
            onContextMenu={(event) => event.preventDefault()}
          >
            متصفحك لا يدعم تشغيل الفيديو.
          </video>
          <div className="video-watermark" aria-hidden="true">{viewerEmail}</div>
        </div> : <div className="locked-lesson">
          <LockKeyhole />
          <h2>اختبار المحاضرة مطلوب</h2>
          <p>أكمل {active?.prerequisiteExamTitle || "اختبار المحاضرة"}{active?.minimumScore ? ` واحصل على ${active.minimumScore}% على الأقل` : ""} قبل تشغيل الفيديو.</p>
          {active?.prerequisiteExamId && <Link href={`/exam/${active.prerequisiteExamId}`} className="btn btn-primary"><FileQuestion /> ابدأ الاختبار</Link>}
        </div>}
        <div className="video-info"><div><span className="section-label">المحاضرة الحالية</span><h1>{active?.title}</h1></div><span className="secure-badge"><ShieldCheck /> بث مؤمّن</span></div>
        {active?.unlocked && <div className="video-security-note"><LockKeyhole /> الفيديو مرتبط بحسابك ويُعرض بعلامة مائية. مشاركة الحساب أو تسجيل المحتوى مخالفة لشروط المنصة.</div>}
      </section>
      <aside className="lesson-sidebar"><h2>محتوى الكورس</h2><div>{videos.map((video, index) => (
        <button key={video.id} className={`${video.id === activeId ? "active" : ""} ${video.unlocked ? "" : "locked"}`} onClick={() => setActiveId(video.id)}>
          <span>{index + 1}</span><div><strong>{video.title}</strong><small>{video.unlocked ? (video.durationSeconds ? `${Math.ceil(video.durationSeconds / 60)} دقيقة` : "فيديو") : "أكمل الاختبار أولاً"}</small></div>{video.unlocked ? <PlayCircle /> : <LockKeyhole />}
        </button>
      ))}</div></aside>
    </div>
  );
}
