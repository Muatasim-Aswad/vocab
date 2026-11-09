-- Study history is final: stored records and their imported source bytes are never rewritten or removed.
CREATE TRIGGER `study_history_no_update` BEFORE UPDATE ON `study_history`
BEGIN
	SELECT RAISE(ABORT, 'study history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `study_history_no_delete` BEFORE DELETE ON `study_history`
BEGIN
	SELECT RAISE(ABORT, 'study history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `study_history_sources_no_update` BEFORE UPDATE ON `study_history_sources`
BEGIN
	SELECT RAISE(ABORT, 'study history sources are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `study_history_sources_no_delete` BEFORE DELETE ON `study_history_sources`
BEGIN
	SELECT RAISE(ABORT, 'study history sources are immutable');
END;
