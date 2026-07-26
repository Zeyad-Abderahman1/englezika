CREATE TABLE IF NOT EXISTS `rate_limits` (
  `key` text PRIMARY KEY NOT NULL,
  `count` integer NOT NULL,
  `reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rate_limits_reset_idx` ON `rate_limits` (`reset_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enrollments_user_course_idx` ON `enrollments` (`user_email`, `course_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `attempts_user_exam_idx` ON `attempts` (`user_email`, `exam_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `attempts_submitted_idx` ON `attempts` (`submitted_at`);
