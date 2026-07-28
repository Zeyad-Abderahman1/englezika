DELETE FROM `video_progress`
WHERE `video_id` IN (SELECT `id` FROM `videos` WHERE `course_id` = 'free-demo-english');
--> statement-breakpoint
DELETE FROM `answers`
WHERE `attempt_id` IN (
  SELECT `id` FROM `attempts`
  WHERE `exam_id` IN (SELECT `id` FROM `exams` WHERE `course_id` = 'free-demo-english')
);
--> statement-breakpoint
DELETE FROM `attempts`
WHERE `exam_id` IN (SELECT `id` FROM `exams` WHERE `course_id` = 'free-demo-english');
--> statement-breakpoint
DELETE FROM `exam_sessions`
WHERE `exam_id` IN (SELECT `id` FROM `exams` WHERE `course_id` = 'free-demo-english');
--> statement-breakpoint
DELETE FROM `questions`
WHERE `exam_id` IN (SELECT `id` FROM `exams` WHERE `course_id` = 'free-demo-english');
--> statement-breakpoint
DELETE FROM `exams` WHERE `course_id` = 'free-demo-english';
--> statement-breakpoint
DELETE FROM `payment_intents` WHERE `course_id` = 'free-demo-english';
--> statement-breakpoint
DELETE FROM `enrollments` WHERE `course_id` = 'free-demo-english';
--> statement-breakpoint
DELETE FROM `videos` WHERE `course_id` = 'free-demo-english';
--> statement-breakpoint
DELETE FROM `courses` WHERE `id` = 'free-demo-english';
