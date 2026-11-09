CREATE TABLE `search_history_clears` (
	`id` text PRIMARY KEY,
	`cleared_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search_history` (
	`id` text PRIMARY KEY,
	`term` text NOT NULL,
	`term_key` text NOT NULL,
	`searched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `search_history_searched_at_idx` ON `search_history` (`searched_at`);