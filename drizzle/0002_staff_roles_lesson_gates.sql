CREATE TABLE `staff_users` (
  `email` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `permissions` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_iterations` integer NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `failed_attempts` integer DEFAULT 0 NOT NULL,
  `locked_until` integer,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `staff_email` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_sessions_email_idx` ON `staff_sessions` (`staff_email`);
--> statement-breakpoint
CREATE INDEX `staff_sessions_expiry_idx` ON `staff_sessions` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `exams` ADD `max_attempts` integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `prerequisite_exam_id` text;
--> statement-breakpoint
ALTER TABLE `videos` ADD `minimum_score` integer DEFAULT 0 NOT NULL;
