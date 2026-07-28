ALTER TABLE `videos` ADD `source_type` text DEFAULT 'upload' NOT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `source_url` text;
--> statement-breakpoint
ALTER TABLE `videos` ADD `youtube_id` text;
