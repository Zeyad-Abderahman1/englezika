CREATE TABLE IF NOT EXISTS `assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `due_at` integer,
  `max_score` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assignments_course_idx` ON `assignments` (`course_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_reads` (
  `user_email` text NOT NULL,
  `notification_type` text NOT NULL,
  `notification_id` text NOT NULL,
  `read_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_reads_user_item_idx`
  ON `notification_reads` (`user_email`, `notification_type`, `notification_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notification_reads_user_idx` ON `notification_reads` (`user_email`);
