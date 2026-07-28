ALTER TABLE `users` ADD `email_verified` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `verification_code` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `verification_code_expires_at` integer;
--> statement-breakpoint
UPDATE `users`
SET `email_verified` = 1
WHERE `email` IN (
  SELECT `email` FROM `email_verifications` WHERE `verified_at` IS NOT NULL
);
