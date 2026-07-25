CREATE TABLE `announcements` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `status` text DEFAULT 'published' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `answers` (
  `id` text PRIMARY KEY NOT NULL,
  `attempt_id` text NOT NULL,
  `question_id` text NOT NULL,
  `answer` text DEFAULT '' NOT NULL,
  `score` integer DEFAULT 0 NOT NULL,
  `feedback` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `answers_attempt_idx` ON `answers` (`attempt_id`);
--> statement-breakpoint
CREATE TABLE `attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `exam_id` text NOT NULL,
  `user_email` text NOT NULL,
  `status` text DEFAULT 'submitted' NOT NULL,
  `score` integer DEFAULT 0 NOT NULL,
  `max_score` integer DEFAULT 0 NOT NULL,
  `feedback` text DEFAULT '' NOT NULL,
  `grading_method` text DEFAULT 'rules' NOT NULL,
  `started_at` integer NOT NULL,
  `submitted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempts_exam_idx` ON `attempts` (`exam_id`);
--> statement-breakpoint
CREATE INDEX `attempts_user_idx` ON `attempts` (`user_email`);
--> statement-breakpoint
CREATE TABLE `contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `phone` text NOT NULL,
  `message` text NOT NULL,
  `status` text DEFAULT 'new' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `courses` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `grade` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `price` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
  `id` text PRIMARY KEY NOT NULL,
  `user_email` text NOT NULL,
  `course_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `payment_method` text,
  `payment_reference` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollments_user_idx` ON `enrollments` (`user_email`);
--> statement-breakpoint
CREATE INDEX `enrollments_course_idx` ON `enrollments` (`course_id`);
--> statement-breakpoint
CREATE TABLE `exam_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `exam_id` text NOT NULL,
  `user_email` text NOT NULL,
  `started_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_sessions_exam_user_idx` ON `exam_sessions` (`exam_id`,`user_email`);
--> statement-breakpoint
CREATE TABLE `exams` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `instructions` text DEFAULT '' NOT NULL,
  `duration_minutes` integer DEFAULT 30 NOT NULL,
  `passing_score` integer DEFAULT 50 NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `opens_at` integer,
  `closes_at` integer,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exams_course_idx` ON `exams` (`course_id`);
--> statement-breakpoint
CREATE TABLE `questions` (
  `id` text PRIMARY KEY NOT NULL,
  `exam_id` text NOT NULL,
  `sort_order` integer NOT NULL,
  `type` text NOT NULL,
  `prompt` text NOT NULL,
  `options` text,
  `correct_answer` text NOT NULL,
  `rubric` text DEFAULT '' NOT NULL,
  `points` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_exam_idx` ON `questions` (`exam_id`);
--> statement-breakpoint
CREATE TABLE `users` (
  `email` text PRIMARY KEY NOT NULL,
  `name` text,
  `phone` text,
  `grade` text,
  `role` text DEFAULT 'student' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text NOT NULL,
  `title` text NOT NULL,
  `r2_key` text NOT NULL,
  `content_type` text DEFAULT 'video/mp4' NOT NULL,
  `duration_seconds` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'published' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `videos_course_idx` ON `videos` (`course_id`);
