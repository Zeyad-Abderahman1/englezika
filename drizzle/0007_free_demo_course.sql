INSERT OR IGNORE INTO `courses` (
  `id`, `title`, `grade`, `description`, `price`, `status`, `created_at`, `updated_at`
) VALUES (
  'free-demo-english',
  'الكورس التجريبي المجاني',
  'أولى ثانوي',
  'كورس مجاني لتجربة التسجيل وتشغيل الفيديو المحمي وفتح المحاضرات داخل منصة إنجليزيكا.',
  0,
  'published',
  1785196800000,
  1785196800000
);
--> statement-breakpoint
INSERT OR IGNORE INTO `videos` (
  `id`, `course_id`, `title`, `r2_key`, `content_type`, `source_type`, `source_url`,
  `youtube_id`, `duration_seconds`, `prerequisite_exam_id`, `minimum_score`, `status`, `created_at`
) VALUES (
  'free-demo-youtube-1',
  'free-demo-english',
  'فيديو تجريبي لتشغيل المشغل الآمن',
  '',
  'video/youtube',
  'youtube',
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  'M7lc1UVf-VE',
  0,
  NULL,
  0,
  'published',
  1785196800001
);
