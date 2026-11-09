CREATE TABLE `study_history_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`report_json` text NOT NULL,
	`imported_at` text NOT NULL,
	CONSTRAINT "study_history_imports_kind_valid" CHECK("kind" IN ('legacy', 'server-logs'))
);
--> statement-breakpoint
CREATE TABLE `study_history_sources` (
	`sha256` text PRIMARY KEY,
	`history_id` text NOT NULL,
	`import_id` integer NOT NULL,
	`source_name` text NOT NULL,
	`size` integer NOT NULL,
	`content` blob NOT NULL,
	CONSTRAINT `fk_study_history_sources_history_id_study_history_id_fk` FOREIGN KEY (`history_id`) REFERENCES `study_history`(`id`),
	CONSTRAINT `fk_study_history_sources_import_id_study_history_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `study_history_imports`(`id`)
);
--> statement-breakpoint
CREATE TABLE `study_history` (
	`id` text PRIMARY KEY,
	`session_id` text UNIQUE,
	`origin` text NOT NULL,
	`schema_version` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`outcome` text,
	`review_count` integer NOT NULL,
	`document_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	CONSTRAINT `fk_study_history_session_id_study_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`),
	CONSTRAINT "study_history_origin_valid" CHECK("origin" IN ('api', 'import')),
	CONSTRAINT "study_history_outcome_valid" CHECK("outcome" IS NULL OR "outcome" IN ('completed', 'quit', 'error')),
	CONSTRAINT "study_history_review_count_nonnegative" CHECK("review_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `study_history_started_idx` ON `study_history` (`started_at`,`id`);