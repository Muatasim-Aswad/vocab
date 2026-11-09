import { sql } from "drizzle-orm";
import { blob, check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { entriesTable } from "../vocabulary/vocabulary.schema.js";

export const studyMemoryTable = sqliteTable(
  "study_memory",
  {
    entryId: integer("entry_id")
      .primaryKey()
      .references(() => entriesTable.id, { onDelete: "cascade" }),
    strength: real("strength").notNull(),
    difficulty: real("difficulty").notNull(),
    streak: integer("streak").notNull(),
    lastReviewed: text("last_reviewed").notNull(),
  },
  (table) => [
    check("study_memory_strength_positive", sql`${table.strength} > 0`),
    check("study_memory_difficulty_positive", sql`${table.difficulty} > 0`),
    check("study_memory_streak_nonnegative", sql`${table.streak} >= 0`),
  ],
);

export const studySessionsTable = sqliteTable(
  "study_sessions",
  {
    id: text("id").primaryKey(),
    stateJson: text("state_json").notNull(),
    revision: integer("revision").notNull().default(1),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    endedAt: text("ended_at"),
  },
  (table) => [check("study_sessions_revision_positive", sql`${table.revision} > 0`)],
);

/**
 * Final, immutable study-history records in their schema-v2 export form. Entry IDs inside a
 * document are historical references, so vocabulary deletion never touches history.
 */
export const studyHistoryTable = sqliteTable(
  "study_history",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .unique()
      .references(() => studySessionsTable.id),
    origin: text("origin", { enum: ["api", "import"] }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    outcome: text("outcome", { enum: ["completed", "quit", "error"] }),
    reviewCount: integer("review_count").notNull(),
    documentJson: text("document_json").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    index("study_history_started_idx").on(table.startedAt, table.id),
    check("study_history_origin_valid", sql`${table.origin} IN ('api', 'import')`),
    check(
      "study_history_outcome_valid",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('completed', 'quit', 'error')`,
    ),
    check("study_history_review_count_nonnegative", sql`${table.reviewCount} >= 0`),
  ],
);

/** One explicit import run and its full input report. */
export const studyHistoryImportsTable = sqliteTable(
  "study_history_imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["legacy", "server-logs"] }).notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    reportJson: text("report_json").notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    check("study_history_imports_kind_valid", sql`${table.kind} IN ('legacy', 'server-logs')`),
  ],
);

/** Exact imported source bytes, deduplicated by SHA-256, for lossless preservation. */
export const studyHistorySourcesTable = sqliteTable("study_history_sources", {
  sha256: text("sha256").primaryKey(),
  historyId: text("history_id")
    .notNull()
    .references(() => studyHistoryTable.id),
  importId: integer("import_id")
    .notNull()
    .references(() => studyHistoryImportsTable.id),
  sourceName: text("source_name").notNull(),
  size: integer("size").notNull(),
  content: blob("content", { mode: "buffer" }).notNull(),
});
