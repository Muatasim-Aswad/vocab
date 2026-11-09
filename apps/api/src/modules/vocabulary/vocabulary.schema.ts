import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { uposValues } from "./upos.js";
import {
  aliasKindValues,
  entryStatusValues,
  multiwordConstructionTypes,
  relationTypeValues,
} from "./vocab.types.js";

export const entriesTable = sqliteTable(
  "entries",
  {
    id: integer("id").primaryKey(),
    lemma: text("lemma").notNull(),
    status: text("status", { enum: entryStatusValues }).notNull().default("active"),
    senseCue: text("sense_cue"),
    extra: text("extra"),
    languageCode: text("language_code").notNull(),
    partOfSpeech: text("part_of_speech", { enum: uposValues }),
    grammarJson: text("grammar_json", { mode: "json" }).$type<Record<string, unknown>>(),
    isMultiWord: integer("is_multi_word", { mode: "boolean" }).notNull().default(false),
    formsJson: text("forms_json", { mode: "json" }).$type<string[]>(),
    examplesJson: text("examples_json", { mode: "json" }).$type<string[]>(),
    collocationsJson: text("collocations_json", { mode: "json" }).$type<string[]>(),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    constructionType: text("construction_type", { enum: multiwordConstructionTypes }),
    addedAt: text("added_at").notNull(),
    modifiedAt: text("modified_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("entries_id_positive", sql`${table.id} > 0`),
    check("entries_revision_positive", sql`${table.revision} > 0`),
    check("entries_status_valid", sql`${table.status} IN ('active', 'stub')`),
    index("entries_status_id_idx").on(table.status, table.id),
    index("entries_modified_at_idx").on(table.modifiedAt),
    index("entries_lemma_idx").on(table.lemma),
    index("entries_part_of_speech_idx").on(table.partOfSpeech),
    index("entries_construction_type_idx").on(table.constructionType),
  ],
);

export const entryAliasesTable = sqliteTable(
  "entry_aliases",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => entriesTable.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: aliasKindValues }).notNull(),
    alias: text("alias").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.alias] }),
    index("entry_aliases_alias_idx").on(table.alias),
  ],
);

export const entryRelationsTable = sqliteTable(
  "entry_relations",
  {
    sourceEntryId: integer("source_entry_id")
      .notNull()
      .references(() => entriesTable.id, { onDelete: "cascade" }),
    targetEntryId: integer("target_entry_id")
      .notNull()
      .references(() => entriesTable.id, { onDelete: "cascade" }),
    relationType: text("relation_type", { enum: relationTypeValues }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceEntryId, table.targetEntryId, table.relationType] }),
    index("entry_relations_source_entry_id_idx").on(table.sourceEntryId),
    index("entry_relations_target_entry_id_idx").on(table.targetEntryId),
  ],
);

export const entryIdAllocatorTable = sqliteTable(
  "entry_id_allocator",
  {
    id: integer("id").primaryKey(),
    lastEntryId: integer("last_entry_id").notNull(),
  },
  (table) => [
    check("entry_id_allocator_singleton", sql`${table.id} = 1`),
    check("entry_id_allocator_nonnegative", sql`${table.lastEntryId} >= 0`),
  ],
);

export const mutationReceiptsTable = sqliteTable("mutation_receipts", {
  mutationId: text("mutation_id").primaryKey(),
  requestHash: text("request_hash").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull(),
});
