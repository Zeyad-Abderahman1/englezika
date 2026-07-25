CREATE TABLE `email_verifications` (
  `email` text PRIMARY KEY NOT NULL,
  `code_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `sent_at` integer NOT NULL,
  `verified_at` integer,
  `delivery_id` text
);
