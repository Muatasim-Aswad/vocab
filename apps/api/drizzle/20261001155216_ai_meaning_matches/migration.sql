CREATE TABLE `ai_meaning_matches` (
	`generation_id` text PRIMARY KEY,
	`attempt_id` text NOT NULL,
	`draft_id` text,
	`match_json` text NOT NULL,
	`validator_version` text NOT NULL,
	CONSTRAINT `fk_ai_meaning_matches_generation_id_ai_generations_id_fk` FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`),
	CONSTRAINT `fk_ai_meaning_matches_attempt_id_ai_provider_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `ai_provider_attempts`(`id`),
	CONSTRAINT `fk_ai_meaning_matches_draft_id_ai_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `ai_drafts`(`id`)
);
