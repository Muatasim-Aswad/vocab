CREATE TABLE `captures` (
	`id` text PRIMARY KEY,
	`term` text NOT NULL,
	`term_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `captures_term_key_unique` ON `captures` (`term_key`);--> statement-breakpoint
CREATE INDEX `captures_created_at_id_idx` ON `captures` (`created_at`,`id`);