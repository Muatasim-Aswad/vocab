CREATE TABLE `ai_draft_events` (
	`id` text PRIMARY KEY,
	`draft_id` text NOT NULL,
	`event_type` text NOT NULL,
	`client_event_id` text UNIQUE,
	`event_hash` text,
	`mutation_id` text,
	`operation` text,
	`observed_at` text NOT NULL,
	`editable_baseline_json` text,
	`submitted_json` text,
	`entry_id` integer,
	`revision_before` integer,
	`revision_after` integer,
	`previous_entry_json` text,
	`persisted_entry_json` text,
	CONSTRAINT `fk_ai_draft_events_draft_id_ai_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `ai_drafts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_drafts` (
	`id` text PRIMARY KEY,
	`generation_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`draft_index` integer NOT NULL,
	`draft_json` text NOT NULL,
	`parsed_json` text NOT NULL,
	`validator_version` text NOT NULL,
	CONSTRAINT `fk_ai_drafts_generation_id_ai_generations_id_fk` FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`),
	CONSTRAINT `fk_ai_drafts_attempt_id_ai_provider_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `ai_provider_attempts`(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY,
	`request_id` text NOT NULL,
	`execution_number` integer NOT NULL,
	`prompt_sha256` text,
	`prepared_term` text,
	`requested_model` text,
	`existing_context_json` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text NOT NULL,
	`error_stage` text,
	`error_code` text,
	CONSTRAINT `fk_ai_generations_request_id_ai_requests_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `ai_requests`(`request_id`),
	CONSTRAINT `fk_ai_generations_prompt_sha256_ai_prompt_versions_sha256_fk` FOREIGN KEY (`prompt_sha256`) REFERENCES `ai_prompt_versions`(`sha256`)
);
--> statement-breakpoint
CREATE TABLE `ai_prompt_versions` (
	`sha256` text PRIMARY KEY,
	`kind` text NOT NULL,
	`system_instruction` text NOT NULL,
	`input_template` text NOT NULL,
	`response_schema_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`validator_version` text NOT NULL,
	`first_used_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_provider_attempts` (
	`id` text PRIMARY KEY,
	`generation_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`request_json` text NOT NULL,
	`response_text` text,
	`response_json` text,
	`returned_model` text,
	`provider_response_id` text,
	`finish_reason` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`thinking_tokens` integer,
	`cached_tokens` integer,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text NOT NULL,
	`error_code` text,
	`retryable` integer,
	`processing_outcome` text,
	`validation_issues_json` text,
	CONSTRAINT `fk_ai_provider_attempts_generation_id_ai_generations_id_fk` FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_requests` (
	`request_id` text PRIMARY KEY,
	`input_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_draft_events_draft_idx` ON `ai_draft_events` (`draft_id`);--> statement-breakpoint
CREATE INDEX `ai_draft_events_entry_revision_idx` ON `ai_draft_events` (`entry_id`,`revision_after`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_draft_events_draft_mutation_idx` ON `ai_draft_events` (`draft_id`,`mutation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_drafts_generation_index_idx` ON `ai_drafts` (`generation_id`,`draft_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generations_request_execution_idx` ON `ai_generations` (`request_id`,`execution_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_attempts_generation_number_idx` ON `ai_provider_attempts` (`generation_id`,`attempt_number`);
--> statement-breakpoint
CREATE TRIGGER ai_requests_immutable_update BEFORE UPDATE ON ai_requests BEGIN SELECT RAISE(ABORT, 'ai_requests are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_requests_immutable_delete BEFORE DELETE ON ai_requests BEGIN SELECT RAISE(ABORT, 'ai_requests are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_prompt_versions_immutable_update BEFORE UPDATE ON ai_prompt_versions BEGIN SELECT RAISE(ABORT, 'ai_prompt_versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_prompt_versions_immutable_delete BEFORE DELETE ON ai_prompt_versions BEGIN SELECT RAISE(ABORT, 'ai_prompt_versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_drafts_immutable_update BEFORE UPDATE ON ai_drafts BEGIN SELECT RAISE(ABORT, 'ai_drafts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_drafts_immutable_delete BEFORE DELETE ON ai_drafts BEGIN SELECT RAISE(ABORT, 'ai_drafts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_draft_events_immutable_update BEFORE UPDATE ON ai_draft_events BEGIN SELECT RAISE(ABORT, 'ai_draft_events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ai_draft_events_immutable_delete BEFORE DELETE ON ai_draft_events BEGIN SELECT RAISE(ABORT, 'ai_draft_events are immutable'); END;
