CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY,
	`secret_hash` text NOT NULL,
	`token_fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `legacy_import_receipt` (
	`id` integer PRIMARY KEY,
	`source_fingerprint` text NOT NULL,
	`source_schema` text NOT NULL,
	`report_json` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_memory` (
	`entry_id` integer PRIMARY KEY,
	`strength` real NOT NULL,
	`difficulty` real NOT NULL,
	`streak` integer NOT NULL,
	`last_reviewed` text NOT NULL,
	CONSTRAINT `fk_study_memory_entry_id_entries_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON DELETE CASCADE,
	CONSTRAINT "study_memory_strength_positive" CHECK("strength" > 0),
	CONSTRAINT "study_memory_difficulty_positive" CHECK("difficulty" > 0),
	CONSTRAINT "study_memory_streak_nonnegative" CHECK("streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT "study_sessions_revision_positive" CHECK("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY,
	`lemma` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sense_cue` text,
	`extra` text,
	`language_code` text NOT NULL,
	`part_of_speech` text,
	`grammar_json` text,
	`is_multi_word` integer DEFAULT false NOT NULL,
	`forms_json` text,
	`examples_json` text,
	`collocations_json` text,
	`tags_json` text,
	`construction_type` text,
	`added_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "entries_id_positive" CHECK("id" > 0),
	CONSTRAINT "entries_revision_positive" CHECK("revision" > 0),
	CONSTRAINT "entries_status_valid" CHECK("status" IN ('active', 'stub'))
);
--> statement-breakpoint
CREATE TABLE `entry_aliases` (
	`entry_id` integer NOT NULL,
	`kind` text NOT NULL,
	`alias` text NOT NULL,
	CONSTRAINT `entry_aliases_pk` PRIMARY KEY(`entry_id`, `alias`),
	CONSTRAINT `fk_entry_aliases_entry_id_entries_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `entry_id_allocator` (
	`id` integer PRIMARY KEY,
	`last_entry_id` integer NOT NULL,
	CONSTRAINT "entry_id_allocator_singleton" CHECK("id" = 1),
	CONSTRAINT "entry_id_allocator_nonnegative" CHECK("last_entry_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE `entry_relations` (
	`source_entry_id` integer NOT NULL,
	`target_entry_id` integer NOT NULL,
	`relation_type` text NOT NULL,
	CONSTRAINT `entry_relations_pk` PRIMARY KEY(`source_entry_id`, `target_entry_id`, `relation_type`),
	CONSTRAINT `fk_entry_relations_source_entry_id_entries_id_fk` FOREIGN KEY (`source_entry_id`) REFERENCES `entries`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entry_relations_target_entry_id_entries_id_fk` FOREIGN KEY (`target_entry_id`) REFERENCES `entries`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`mutation_id` text PRIMARY KEY,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_token_fingerprint_idx` ON `auth_sessions` (`token_fingerprint`);--> statement-breakpoint
CREATE INDEX `entries_status_id_idx` ON `entries` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `entries_lemma_idx` ON `entries` (`lemma`);--> statement-breakpoint
CREATE INDEX `entries_part_of_speech_idx` ON `entries` (`part_of_speech`);--> statement-breakpoint
CREATE INDEX `entries_construction_type_idx` ON `entries` (`construction_type`);--> statement-breakpoint
CREATE INDEX `entry_aliases_alias_idx` ON `entry_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `entry_relations_source_entry_id_idx` ON `entry_relations` (`source_entry_id`);--> statement-breakpoint
CREATE INDEX `entry_relations_target_entry_id_idx` ON `entry_relations` (`target_entry_id`);
--> statement-breakpoint
INSERT INTO `entry_id_allocator` (`id`, `last_entry_id`) VALUES (1, 0);
