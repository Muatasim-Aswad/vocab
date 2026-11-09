-- Search history is append-only: rows are never rewritten. Deletes stay possible for a future retention rule.
CREATE TRIGGER `search_history_no_update` BEFORE UPDATE ON `search_history`
BEGIN
	SELECT RAISE(ABORT, 'search history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `search_history_clears_no_update` BEFORE UPDATE ON `search_history_clears`
BEGIN
	SELECT RAISE(ABORT, 'search history clears are append-only');
END;
