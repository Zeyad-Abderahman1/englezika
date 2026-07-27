CREATE TABLE IF NOT EXISTS `video_progress` (
  `id` text PRIMARY KEY NOT NULL,
  `user_email` text NOT NULL,
  `video_id` text NOT NULL,
  `completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `video_progress_user_video_idx` ON `video_progress` (`user_email`, `video_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `video_progress_video_idx` ON `video_progress` (`video_id`);
