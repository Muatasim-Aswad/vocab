import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const aiRequestsTable = sqliteTable("ai_requests", {
  requestId: text("request_id").primaryKey(),
  inputJson: text("input_json").notNull(),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const aiPromptVersionsTable = sqliteTable("ai_prompt_versions", {
  sha256: text("sha256").primaryKey(),
  kind: text("kind").notNull(),
  systemInstruction: text("system_instruction").notNull(),
  inputTemplate: text("input_template").notNull(),
  responseSchemaJson: text("response_schema_json").notNull(),
  settingsJson: text("settings_json").notNull(),
  validatorVersion: text("validator_version").notNull(),
  firstUsedAt: text("first_used_at").notNull(),
});

export const aiGenerationsTable = sqliteTable(
  "ai_generations",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => aiRequestsTable.requestId),
    executionNumber: integer("execution_number").notNull(),
    promptSha256: text("prompt_sha256").references(() => aiPromptVersionsTable.sha256),
    preparedTerm: text("prepared_term"),
    requestedModel: text("requested_model"),
    existingContextJson: text("existing_context_json"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    outcome: text("outcome").notNull(),
    errorStage: text("error_stage"),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("ai_generations_request_execution_idx").on(table.requestId, table.executionNumber),
  ],
);

export const aiProviderAttemptsTable = sqliteTable(
  "ai_provider_attempts",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => aiGenerationsTable.id),
    attemptNumber: integer("attempt_number").notNull(),
    requestJson: text("request_json").notNull(),
    responseText: text("response_text"),
    responseJson: text("response_json"),
    returnedModel: text("returned_model"),
    providerResponseId: text("provider_response_id"),
    finishReason: text("finish_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    thinkingTokens: integer("thinking_tokens"),
    cachedTokens: integer("cached_tokens"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    retryable: integer("retryable", { mode: "boolean" }),
    processingOutcome: text("processing_outcome"),
    validationIssuesJson: text("validation_issues_json"),
  },
  (table) => [
    uniqueIndex("ai_provider_attempts_generation_number_idx").on(
      table.generationId,
      table.attemptNumber,
    ),
  ],
);

export const aiDraftsTable = sqliteTable(
  "ai_drafts",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => aiGenerationsTable.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => aiProviderAttemptsTable.id),
    draftIndex: integer("draft_index").notNull(),
    draftJson: text("draft_json").notNull(),
    parsedJson: text("parsed_json").notNull(),
    validatorVersion: text("validator_version").notNull(),
  },
  (table) => [
    uniqueIndex("ai_drafts_generation_index_idx").on(table.generationId, table.draftIndex),
  ],
);

export const aiMeaningMatchesTable = sqliteTable("ai_meaning_matches", {
  generationId: text("generation_id")
    .primaryKey()
    .references(() => aiGenerationsTable.id),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => aiProviderAttemptsTable.id),
  draftId: text("draft_id").references(() => aiDraftsTable.id),
  matchJson: text("match_json").notNull(),
  validatorVersion: text("validator_version").notNull(),
});

export const aiDraftEventsTable = sqliteTable(
  "ai_draft_events",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => aiDraftsTable.id),
    eventType: text("event_type").notNull(),
    clientEventId: text("client_event_id").unique(),
    eventHash: text("event_hash"),
    mutationId: text("mutation_id"),
    operation: text("operation"),
    observedAt: text("observed_at").notNull(),
    editableBaselineJson: text("editable_baseline_json"),
    submittedJson: text("submitted_json"),
    entryId: integer("entry_id"),
    revisionBefore: integer("revision_before"),
    revisionAfter: integer("revision_after"),
    previousEntryJson: text("previous_entry_json"),
    persistedEntryJson: text("persisted_entry_json"),
  },
  (table) => [
    index("ai_draft_events_draft_idx").on(table.draftId),
    index("ai_draft_events_entry_revision_idx").on(table.entryId, table.revisionAfter),
    uniqueIndex("ai_draft_events_draft_mutation_idx").on(table.draftId, table.mutationId),
  ],
);
