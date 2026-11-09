import { inArray, sql } from "drizzle-orm";

import { Database } from "../../infra/db/database.js";
import { systemNowIso } from "../../shared/clock.js";
import type { StudyMemoryService } from "../study/study-memory.service.js";
import { buildEntryAliases, normalizeAliasText } from "./alias-index.js";
import { AppError, isAppError } from "./domain-error.js";
import type { VocabLanguagePolicy } from "./language-policy.types.js";
import { nlVocabLanguagePolicy } from "./nl/repositoryLanguagePolicy.js";
import { parseRelatedToken } from "./relation-tokens.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import { validateSenseCue } from "./sense-cue.js";
import { uposValues } from "./upos.js";
import {
  aliasKindValues,
  entryStatusValues,
  multiwordConstructionTypes,
  relationTypeValues,
} from "./vocab.types.js";
import type {
  CreateVocabEntry,
  EntryGrammar,
  EntryListOrder,
  EntryRelation,
  PaginatedVocabEntryResult,
  RelationshipType,
  Result,
  SearchQueryOptions,
  UpdateVocabEntry,
  VocabEntry,
} from "./vocab.types.js";
import {
  TYPE_FILTER_SQL_FUNCTION,
  VocabularySearchRepository,
} from "./vocabulary-search.repository.js";
import { entriesTable, entryRelationsTable } from "./vocabulary.schema.js";
import { formatDisplayTerm, parseTermInput } from "./word-normalization.js";

const entryStatusSet = new Set<string>(entryStatusValues);
const uposSet = new Set<(typeof uposValues)[number]>(uposValues);
const constructionTypeSet = new Set<(typeof multiwordConstructionTypes)[number]>(
  multiwordConstructionTypes,
);
const aliasKindSet = new Set<(typeof aliasKindValues)[number]>(aliasKindValues);
const relationTypeSet = new Set<(typeof relationTypeValues)[number]>(relationTypeValues);

export type VocabRepositoryDeps = {
  nowIso: () => string;
};

const defaultVocabRepositoryDeps: VocabRepositoryDeps = {
  nowIso: systemNowIso,
};

export type SqliteVocabRepositoryOptions = {
  repositoryDeps?: Partial<VocabRepositoryDeps>;
  languagePolicy?: VocabLanguagePolicy;
};

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveAllowedValue<T extends string>(
  value: string | undefined,
  set: Set<T>,
): T | undefined {
  if (!value) {
    return undefined;
  }

  return [...set].find((candidate) => candidate === value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function asGrammar(value: unknown): EntryGrammar | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const cloned = { ...value };
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function cloneEntry(entry: VocabEntry): VocabEntry {
  return {
    ...entry,
    ...(entry.memory ? { memory: { ...entry.memory } } : {}),
    ...(entry.relations ? { relations: entry.relations.map((relation) => ({ ...relation })) } : {}),
    ...(entry.examples ? { examples: [...entry.examples] } : {}),
    ...(entry.collocations ? { collocations: [...entry.collocations] } : {}),
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
    ...(entry.forms ? { forms: [...entry.forms] } : {}),
    ...(entry.grammar ? { grammar: { ...entry.grammar } } : {}),
    meta: { ...entry.meta },
  };
}

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// Subset of the better-sqlite3 client used to register SQL functions.
type SqliteFunctionHost = {
  function(
    name: string,
    options: { deterministic: boolean },
    implementation: (...args: unknown[]) => number,
  ): unknown;
};

// Evaluates the injected language policy per row inside SQLite so filtering precedes pagination.
function registerTypeFilterFunction(
  client: SqliteFunctionHost,
  languagePolicy: VocabLanguagePolicy,
): void {
  client.function(
    TYPE_FILTER_SQL_FUNCTION,
    { deterministic: true },
    (
      normalizedFilter,
      id,
      lemma,
      languageCode,
      isMultiWord,
      partOfSpeech,
      constructionType,
      grammarJson,
      tagsJson,
    ) => {
      const grammar = asGrammar(parseJsonColumn(grammarJson));
      const tags = asStringArray(parseJsonColumn(tagsJson));
      const entry: VocabEntry = {
        id: Number(id),
        lemma: String(lemma),
        language: String(languageCode),
        isMultiWord: Boolean(isMultiWord),
        meta: { addedAt: "", modifiedAt: "" },
        ...(typeof partOfSpeech === "string" && partOfSpeech ? { partOfSpeech } : {}),
        ...(typeof constructionType === "string" && constructionType
          ? { constructionType: resolveAllowedValue(constructionType, constructionTypeSet) }
          : {}),
        ...(grammar ? { grammar } : {}),
        ...(tags ? { tags } : {}),
      };

      return languagePolicy.matchesTypeFilter(entry, String(normalizedFilter)) ? 1 : 0;
    },
  );
}

const upsertEntryClause = sql`
  ON CONFLICT(id) DO UPDATE SET
    lemma = excluded.lemma,
    status = excluded.status,
    sense_cue = excluded.sense_cue,
    extra = excluded.extra,
    language_code = excluded.language_code,
    part_of_speech = excluded.part_of_speech,
    grammar_json = excluded.grammar_json,
    is_multi_word = excluded.is_multi_word,
    forms_json = excluded.forms_json,
    examples_json = excluded.examples_json,
    collocations_json = excluded.collocations_json,
    tags_json = excluded.tags_json,
    construction_type = excluded.construction_type,
    added_at = excluded.added_at,
    modified_at = excluded.modified_at,
    revision = excluded.revision
`;

// Aborts a backfill transaction whose target disappeared; mapped to a not-found result.
class MissingBackfillTargetError extends Error {}

function mergeConstructionTypeUpdate(
  entry: VocabEntry,
  constructionType: VocabEntry["constructionType"],
): void {
  if (constructionType) {
    entry.constructionType = constructionType;
  } else {
    delete entry.constructionType;
  }
}

function isSymmetricRelation(type: RelationshipType): boolean {
  return (
    type === "related" ||
    type === "synonym" ||
    type === "antonym" ||
    type === "wordFamily" ||
    type === "posVariation"
  );
}

function relationKey(relation: EntryRelation): string {
  return `${relation.type}:${relation.targetEntryId}`;
}

function dedupeRelations(relations: EntryRelation[]): EntryRelation[] {
  const deduped: EntryRelation[] = [];
  const seen = new Set<string>();

  for (const relation of relations) {
    if (!Number.isFinite(relation.targetEntryId) || relation.targetEntryId <= 0) {
      continue;
    }
    if (!relationTypeSet.has(relation.type)) {
      continue;
    }

    const key = relationKey(relation);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(relation);
  }

  return deduped;
}

export class SqliteVocabRepository implements VocabRepositoryPort {
  private readonly db: Database["orm"];
  private readonly languagePolicy: VocabLanguagePolicy;
  private readonly deps: VocabRepositoryDeps;
  private readonly studyMemory: StudyMemoryService;
  private readonly queries: VocabularySearchRepository;

  constructor(
    database: Database,
    studyMemory: StudyMemoryService,
    options: SqliteVocabRepositoryOptions = {},
  ) {
    this.studyMemory = studyMemory;
    this.db = database.orm;
    this.queries = new VocabularySearchRepository(this.db, (ids) => this.readEntriesByIds(ids));
    this.languagePolicy = options.languagePolicy ?? nlVocabLanguagePolicy;
    this.deps = { ...defaultVocabRepositoryDeps, ...options.repositoryDeps };
    registerTypeFilterFunction(database.sqlite, this.languagePolicy);
  }

  get terms(): string[] {
    return this.readAllEntries().map((entry) => formatDisplayTerm(entry));
  }

  // Must run inside the creating transaction so a rollback also releases the ID.
  // MAX(id) guards against rows written by binaries that predate the allocator.
  private allocateEntryId(): number {
    const row = this.db.get<{ id: number }>(sql`
      UPDATE entry_id_allocator
      SET last_entry_id = MAX(last_entry_id, (SELECT COALESCE(MAX(id), 0) FROM entries)) + 1
      WHERE id = 1
      RETURNING last_entry_id AS id
    `);
    if (!row) {
      throw new Error("Entry ID allocator is not initialized. Run: pnpm db:migrate");
    }
    return row.id;
  }

  private readEntriesByIds(ids: number[]): VocabEntry[] {
    if (ids.length === 0) {
      return [];
    }

    const entryRows = this.db
      .select()
      .from(entriesTable)
      .where(inArray(entriesTable.id, ids))
      .all();
    if (entryRows.length === 0) {
      return [];
    }

    const entryIds = entryRows.map((row) => row.id);
    const relationRows = this.db
      .select()
      .from(entryRelationsTable)
      .where(inArray(entryRelationsTable.sourceEntryId, entryIds))
      .all();
    const memoryByEntryId = this.studyMemory.findByIds(entryIds);

    const relationsBySource = new Map<number, EntryRelation[]>();
    for (const row of relationRows) {
      const existing = relationsBySource.get(row.sourceEntryId) ?? [];
      existing.push({ type: row.relationType, targetEntryId: row.targetEntryId });
      relationsBySource.set(row.sourceEntryId, existing);
    }

    const byId = new Map<number, VocabEntry>();
    for (const row of entryRows) {
      const grammar = asGrammar(row.grammarJson);
      const forms = asStringArray(row.formsJson);
      const examples = asStringArray(row.examplesJson);
      const collocations = asStringArray(row.collocationsJson);
      const tags = asStringArray(row.tagsJson);
      const relations = relationsBySource.get(row.id);
      const memory = memoryByEntryId.get(row.id);

      const entry: VocabEntry = {
        id: row.id,
        revision: row.revision,
        lemma: row.lemma,
        status: row.status,
        language: row.languageCode,
        isMultiWord: row.isMultiWord,
        meta: {
          addedAt: row.addedAt,
          modifiedAt: row.modifiedAt,
        },
      };

      if (row.senseCue) {
        entry.senseCue = row.senseCue;
      }
      if (row.extra) {
        entry.extra = row.extra;
      }
      if (row.partOfSpeech) {
        entry.partOfSpeech = row.partOfSpeech;
      }
      if (grammar) {
        entry.grammar = grammar;
      }
      if (forms) {
        entry.forms = forms;
      }
      if (examples) {
        entry.examples = examples;
      }
      if (collocations) {
        entry.collocations = collocations;
      }
      if (tags) {
        entry.tags = tags;
      }
      if (row.constructionType) {
        entry.constructionType = row.constructionType;
      }
      if (relations && relations.length > 0) {
        entry.relations = dedupeRelations(relations);
      }

      if (entry.status !== "stub" && memory) {
        entry.memory = {
          strength: memory.strength,
          difficulty: memory.difficulty,
          streak: memory.streak,
          lastReviewed: memory.lastReviewed,
        };
      }

      byId.set(entry.id, entry);
    }

    return ids.map((id) => byId.get(id)).filter((entry): entry is VocabEntry => Boolean(entry));
  }

  private readEntryById(id: number): VocabEntry | null {
    return this.readEntriesByIds([id])[0] ?? null;
  }

  private readAllEntries(): VocabEntry[] {
    const ids = this.db
      .select({ id: entriesTable.id })
      .from(entriesTable)
      .orderBy(entriesTable.id)
      .all()
      .map((row) => row.id);

    return this.readEntriesByIds(ids);
  }

  findByLemma(
    lemma: string,
    options?: {
      excludeId?: number;
    },
  ): VocabEntry[] {
    const normalizedLemma = normalizeAliasText(lemma);
    if (!normalizedLemma) {
      return [];
    }

    const hasExcludeId =
      Number.isFinite(options?.excludeId) && typeof options?.excludeId === "number"
        ? Math.trunc(options.excludeId) > 0
        : false;

    const rows = hasExcludeId
      ? this.db.all<{ entry_id: number }>(sql`
          SELECT DISTINCT a.entry_id AS entry_id
          FROM entry_aliases a
          WHERE a.kind = 'lemma'
            AND a.alias = ${normalizedLemma}
            AND a.entry_id != ${Math.trunc(options!.excludeId!)}
          ORDER BY a.entry_id ASC
        `)
      : this.db.all<{ entry_id: number }>(sql`
          SELECT DISTINCT a.entry_id AS entry_id
          FROM entry_aliases a
          WHERE a.kind = 'lemma'
            AND a.alias = ${normalizedLemma}
          ORDER BY a.entry_id ASC
        `);

    return this.readEntriesByIds(rows.map((row) => row.entry_id));
  }

  findByForm(form: string): VocabEntry[] {
    const normalizedForm = normalizeAliasText(form);
    if (!normalizedForm) {
      return [];
    }

    const rows = this.db.all<{ entry_id: number }>(sql`
      SELECT DISTINCT entry_id
      FROM entry_aliases
      WHERE kind = 'form'
        AND alias = ${normalizedForm}
      ORDER BY entry_id ASC
    `);

    return this.readEntriesByIds(rows.map((row) => row.entry_id));
  }

  findByTerm(term: string): VocabEntry[] {
    const normalizedAlias = normalizeAliasText(term);
    if (!normalizedAlias) {
      return [];
    }

    const rows = this.db.all<{ entry_id: number }>(sql`
      SELECT DISTINCT entry_id
      FROM entry_aliases
      WHERE alias = ${normalizedAlias}
      ORDER BY entry_id ASC
    `);

    const ids = rows.map((row) => row.entry_id);
    const entries = this.readEntriesByIds(ids);
    return entries.toSorted((left, right) =>
      formatDisplayTerm(left).localeCompare(formatDisplayTerm(right)),
    );
  }

  findByIds(ids: number[]): VocabEntry[] {
    const valid = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
    return valid.length ? this.readEntriesByIds(valid) : [];
  }

  findById(id: number): VocabEntry | null {
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }

    return this.readEntryById(Math.trunc(id));
  }

  findLast(): VocabEntry | null {
    const row = this.db.get<{ id: number }>(
      sql`SELECT id FROM entries WHERE status != 'stub' ORDER BY id DESC LIMIT 1`,
    );
    if (!row) {
      return null;
    }

    return this.readEntryById(row.id);
  }

  search(query: string, options: SearchQueryOptions = {}): PaginatedVocabEntryResult {
    return this.queries.search(query, options);
  }

  paginate(options?: {
    cursor?: number;
    limit?: number;
    typeFilter?: string;
    order?: EntryListOrder;
  }): PaginatedVocabEntryResult {
    return this.queries.paginate(options);
  }

  private hasLexicalUpdate(updateData: UpdateVocabEntry): boolean {
    return (
      hasOwn(updateData, "lemma") ||
      hasOwn(updateData, "senseCue") ||
      hasOwn(updateData, "extra") ||
      hasOwn(updateData, "isMultiWord") ||
      hasOwn(updateData, "grammar") ||
      hasOwn(updateData, "forms") ||
      hasOwn(updateData, "partOfSpeech") ||
      hasOwn(updateData, "constructionType") ||
      hasOwn(updateData, "tags") ||
      hasOwn(updateData, "examples") ||
      hasOwn(updateData, "collocations")
    );
  }

  // "insert" never overwrites an existing row, so an ID collision fails the transaction.
  private persistEntry(entry: VocabEntry, mode: "insert" | "upsert" = "upsert"): void {
    const status = entry.status && entryStatusSet.has(entry.status) ? entry.status : "active";
    const partOfSpeech = resolveAllowedValue(entry.partOfSpeech, uposSet);
    const constructionType = resolveAllowedValue(entry.constructionType, constructionTypeSet);

    this.db.run(sql`
      INSERT INTO entries (
        id, lemma, status, sense_cue, extra, language_code, part_of_speech, grammar_json,
        is_multi_word, forms_json, examples_json, collocations_json, tags_json,
        construction_type, added_at, modified_at, revision
      ) VALUES (
        ${entry.id},
        ${entry.lemma},
        ${status},
        ${entry.senseCue ?? null},
        ${entry.extra ?? null},
        ${entry.language},
        ${partOfSpeech ?? null},
        ${entry.grammar ? JSON.stringify(entry.grammar) : null},
        ${entry.isMultiWord ? 1 : 0},
        ${entry.forms ? JSON.stringify(entry.forms) : null},
        ${entry.examples ? JSON.stringify(entry.examples) : null},
        ${entry.collocations ? JSON.stringify(entry.collocations) : null},
        ${entry.tags ? JSON.stringify(entry.tags) : null},
        ${constructionType ?? null},
        ${entry.meta.addedAt},
        ${entry.meta.modifiedAt},
        ${entry.revision ?? 1}
      )
      ${mode === "insert" ? sql`` : upsertEntryClause}
    `);

    this.db.run(sql`DELETE FROM entry_aliases WHERE entry_id = ${entry.id}`);
    for (const alias of buildEntryAliases(entry)) {
      if (!aliasKindSet.has(alias.kind)) {
        continue;
      }

      this.db.run(sql`
        INSERT INTO entry_aliases (entry_id, kind, alias)
        VALUES (${alias.entryId}, ${alias.kind}, ${alias.alias})
      `);
    }

    this.studyMemory.syncEntry(entry.id, status, entry.meta.modifiedAt);
  }

  private readRelationsForSource(sourceEntryId: number): EntryRelation[] {
    const rows = this.db.all<{ targetEntryId: number; relationType: RelationshipType }>(sql`
      SELECT target_entry_id AS targetEntryId, relation_type AS relationType
      FROM entry_relations
      WHERE source_entry_id = ${sourceEntryId}
      ORDER BY relation_type ASC, target_entry_id ASC
    `);

    return dedupeRelations(
      rows.map((row) => ({ type: row.relationType, targetEntryId: row.targetEntryId })),
    );
  }

  private replaceSourceRelations(sourceEntryId: number, relations: EntryRelation[]): void {
    const normalized = dedupeRelations(relations);

    this.db.run(sql`DELETE FROM entry_relations WHERE source_entry_id = ${sourceEntryId}`);
    for (const relation of normalized) {
      this.db.run(sql`
        INSERT INTO entry_relations (source_entry_id, target_entry_id, relation_type)
        VALUES (${sourceEntryId}, ${relation.targetEntryId}, ${relation.type})
      `);
    }
  }

  private insertRelation(sourceEntryId: number, relation: EntryRelation): void {
    if (!Number.isFinite(relation.targetEntryId) || relation.targetEntryId <= 0) {
      return;
    }
    if (!relationTypeSet.has(relation.type)) {
      return;
    }

    this.db.run(sql`
      INSERT OR IGNORE INTO entry_relations (source_entry_id, target_entry_id, relation_type)
      VALUES (${sourceEntryId}, ${relation.targetEntryId}, ${relation.type})
    `);
  }

  private findLexicalAliasEntryIds(
    alias: string,
    options: {
      status: "active" | "stub";
    },
  ): number[] {
    const rows =
      options.status === "active"
        ? this.db.all<{ id: number }>(sql`
            SELECT e.id AS id
            FROM entries e
            JOIN entry_aliases a ON a.entry_id = e.id
            WHERE a.alias = ${alias}
              AND a.kind IN ('lemma', 'variant', 'manual')
              AND e.status != 'stub'
            ORDER BY e.id ASC
          `)
        : this.db.all<{ id: number }>(sql`
            SELECT e.id AS id
            FROM entries e
            JOIN entry_aliases a ON a.entry_id = e.id
            WHERE a.alias = ${alias}
              AND a.kind IN ('lemma', 'variant', 'manual')
              AND e.status = 'stub'
            ORDER BY e.id ASC
          `);

    return rows.map((row) => row.id);
  }

  private createStubEntry(normalizedDisplayTerm: string, now: string): VocabEntry {
    const parsedTerm = parseTermInput(normalizedDisplayTerm);
    const stub: VocabEntry = {
      id: this.allocateEntryId(),
      language: this.languagePolicy.defaultLanguage,
      lemma: parsedTerm.lemma,
      status: "stub",
      isMultiWord: parsedTerm.isMultiWord,
      ...(parsedTerm.grammar ? { grammar: { ...parsedTerm.grammar } } : {}),
      meta: {
        addedAt: now,
        modifiedAt: now,
      },
    };

    this.languagePolicy.normalizeEntry(stub);
    this.persistEntry(stub, "insert");
    return stub;
  }

  private resolveRelationTargetId(
    sourceEntry: VocabEntry,
    token: string,
    now: string,
  ): EntryRelation | null {
    const parsedToken = parseRelatedToken(token);
    if (!parsedToken) {
      throw new AppError("INVALID_RELATION_TOKEN", {
        context: {
          token,
          sourceId: sourceEntry.id,
        },
      });
    }

    let targetId: number;
    if ("targetEntryId" in parsedToken) {
      const target = this.readEntryById(parsedToken.targetEntryId);
      if (!target) {
        throw new AppError("RELATION_TARGET_NOT_FOUND_BY_ID", {
          context: {
            token,
            sourceId: sourceEntry.id,
            targetEntryId: parsedToken.targetEntryId,
          },
        });
      }
      targetId = target.id;
    } else {
      const activeIds = this.findLexicalAliasEntryIds(parsedToken.term, { status: "active" });
      if (activeIds.length > 1) {
        throw new AppError("RELATION_TARGET_AMBIGUOUS", {
          context: {
            token,
            term: parsedToken.term,
            sourceId: sourceEntry.id,
            entries: this.readEntriesByIds(activeIds),
          },
        });
      }

      if (activeIds.length === 1) {
        targetId = activeIds[0]!;
      } else {
        const stubIds = this.findLexicalAliasEntryIds(parsedToken.term, { status: "stub" });
        if (stubIds.length > 0) {
          targetId = stubIds[0]!;
        } else {
          targetId = this.createStubEntry(parsedToken.term, now).id;
        }
      }
    }

    if (targetId === sourceEntry.id) {
      return null;
    }

    return {
      type: parsedToken.type,
      targetEntryId: targetId,
    };
  }

  private hasSpecificRelationBetween(sourceEntryId: number, targetEntryId: number): boolean {
    if (sourceEntryId === targetEntryId) {
      return false;
    }

    const targetExists =
      this.db.get<{ hit: number }>(
        sql`SELECT 1 AS hit FROM entries WHERE id = ${targetEntryId} LIMIT 1`,
      ) !== undefined;
    if (!targetExists) {
      return false;
    }

    const row = this.db.get<{ hit: number }>(sql`
      SELECT 1 AS hit
      FROM entry_relations
      WHERE (
        (source_entry_id = ${sourceEntryId} AND target_entry_id = ${targetEntryId})
        OR (source_entry_id = ${targetEntryId} AND target_entry_id = ${sourceEntryId})
      )
        AND relation_type != 'related'
      LIMIT 1
    `);

    return row !== undefined;
  }

  private removeRelatedBidirectional(sourceEntryId: number, targetEntryId: number): void {
    this.db.run(sql`
      DELETE FROM entry_relations
      WHERE source_entry_id = ${sourceEntryId}
        AND target_entry_id = ${targetEntryId}
        AND relation_type = 'related'
    `);

    this.db.run(sql`
      DELETE FROM entry_relations
      WHERE source_entry_id = ${targetEntryId}
        AND target_entry_id = ${sourceEntryId}
        AND relation_type = 'related'
    `);
  }

  private enforceSpecificOverRelatedForPair(sourceEntryId: number, targetEntryId: number): void {
    if (sourceEntryId === targetEntryId) {
      return;
    }

    if (!this.hasSpecificRelationBetween(sourceEntryId, targetEntryId)) {
      return;
    }

    this.removeRelatedBidirectional(sourceEntryId, targetEntryId);
  }

  private applyRelationsFromTokens(sourceEntry: VocabEntry, tokens: string[], now: string): void {
    const previous = this.readRelationsForSource(sourceEntry.id);
    const next: EntryRelation[] = [];
    const seen = new Set<string>();
    const touchedTargetIds = new Set<number>();

    for (const token of tokens) {
      const resolved = this.resolveRelationTargetId(sourceEntry, token, now);
      if (!resolved) {
        continue;
      }

      const key = relationKey(resolved);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      next.push(resolved);
      touchedTargetIds.add(resolved.targetEntryId);
    }

    for (const relation of previous) {
      touchedTargetIds.add(relation.targetEntryId);
    }

    const previousKeys = new Set(previous.map((relation) => relationKey(relation)));
    const nextKeys = new Set(next.map((relation) => relationKey(relation)));

    for (const relation of previous) {
      if (!isSymmetricRelation(relation.type)) {
        continue;
      }
      if (nextKeys.has(relationKey(relation))) {
        continue;
      }

      this.db.run(sql`
        DELETE FROM entry_relations
        WHERE source_entry_id = ${relation.targetEntryId}
          AND target_entry_id = ${sourceEntry.id}
          AND relation_type = ${relation.type}
      `);
    }

    this.replaceSourceRelations(sourceEntry.id, next);

    for (const relation of next) {
      if (!isSymmetricRelation(relation.type)) {
        continue;
      }
      if (previousKeys.has(relationKey(relation))) {
        continue;
      }

      this.insertRelation(relation.targetEntryId, {
        type: relation.type,
        targetEntryId: sourceEntry.id,
      });
    }

    for (const targetId of touchedTargetIds) {
      this.enforceSpecificOverRelatedForPair(sourceEntry.id, targetId);
    }
  }

  private pruneOrphanStubs(): void {
    while (true) {
      const orphanRows = this.db.all<{ id: number }>(sql`
        SELECT e.id AS id
        FROM entries e
        WHERE e.status = 'stub'
          AND NOT EXISTS (
            SELECT 1
            FROM entry_relations r
            WHERE r.source_entry_id = e.id
          )
      `);

      if (orphanRows.length === 0) {
        return;
      }

      const orphanIds = orphanRows.map((row) => row.id);
      this.db.delete(entriesTable).where(inArray(entriesTable.id, orphanIds)).run();
    }
  }

  private buildEntryFromCreateData(
    data: CreateVocabEntry,
    now: string,
  ): {
    entry: VocabEntry;
    relatedTokens: string[] | undefined;
  } {
    const {
      lemma,
      senseCue,
      extra,
      status,
      isMultiWord,
      grammar,
      forms,
      relatedTokens,
      examples,
      collocations,
      partOfSpeech,
      constructionType,
      tags,
    } = data;

    const normalizedPartOfSpeech = this.languagePolicy.normalizePartOfSpeech(partOfSpeech);

    const entry: VocabEntry = {
      id: this.allocateEntryId(),
      language: data.language ?? this.languagePolicy.defaultLanguage,
      lemma,
      status: status ?? "active",
      ...(senseCue ? { senseCue } : {}),
      ...(extra ? { extra } : {}),
      isMultiWord: isMultiWord ?? false,
      ...(normalizedPartOfSpeech ? { partOfSpeech: normalizedPartOfSpeech } : {}),
      ...(constructionType ? { constructionType } : {}),
      ...(tags ? { tags } : {}),
      ...(examples && examples.length > 0 ? { examples } : {}),
      ...(collocations && collocations.length > 0 ? { collocations } : {}),
      ...(forms && forms.length > 0 ? { forms: [...forms] } : {}),
      ...(grammar && Object.keys(grammar).length > 0 ? { grammar: { ...grammar } } : {}),
      ...((status ?? "active") === "active" ? { memory: this.studyMemory.initialMemory(now) } : {}),
      meta: {
        addedAt: now,
        modifiedAt: now,
      },
    };
    this.languagePolicy.normalizeEntry(entry);

    return {
      entry,
      relatedTokens,
    };
  }

  private applyUpdateData(
    currentEntry: VocabEntry,
    updateData: UpdateVocabEntry,
    now: string,
  ): VocabEntry {
    const {
      lemma: newLemma,
      senseCue,
      extra,
      status,
      grammar,
      forms,
      examples,
      collocations,
      partOfSpeech,
      tags,
      constructionType,
      meta,
    } = updateData;

    const entry = cloneEntry(currentEntry);

    if (newLemma !== undefined) {
      entry.lemma = newLemma;
    }

    if (status !== undefined) {
      entry.status = status;
    }

    if (senseCue !== undefined) {
      if (senseCue.trim()) {
        entry.senseCue = senseCue;
      } else {
        delete entry.senseCue;
      }
    }

    if (extra !== undefined) {
      if (extra.trim()) {
        entry.extra = extra;
      } else {
        delete entry.extra;
      }
    }

    if (hasOwn(updateData, "isMultiWord")) {
      entry.isMultiWord = updateData.isMultiWord === true;
    }

    if (grammar !== undefined) {
      this.languagePolicy.mergeGrammarUpdate(entry, grammar);
    }

    if (forms !== undefined) {
      if (forms.length > 0) {
        entry.forms = [...forms];
      } else {
        delete entry.forms;
      }
    }

    if (hasOwn(updateData, "partOfSpeech")) {
      const normalizedPartOfSpeech = this.languagePolicy.normalizePartOfSpeech(partOfSpeech);
      if (normalizedPartOfSpeech) {
        entry.partOfSpeech = normalizedPartOfSpeech;
      } else {
        delete entry.partOfSpeech;
      }
    }

    if (hasOwn(updateData, "constructionType")) {
      mergeConstructionTypeUpdate(entry, constructionType);
    }

    if (tags !== undefined) {
      if (tags.length > 0) {
        entry.tags = tags;
      } else {
        delete entry.tags;
      }
    }

    if (examples !== undefined) {
      if (examples.length > 0) {
        entry.examples = examples;
      } else {
        delete entry.examples;
      }
    }

    if (collocations !== undefined) {
      if (collocations.length > 0) {
        entry.collocations = collocations;
      } else {
        delete entry.collocations;
      }
    }

    if (meta !== undefined) {
      if (meta.addedAt !== undefined) entry.meta.addedAt = meta.addedAt;
      if (meta.modifiedAt !== undefined) entry.meta.modifiedAt = meta.modifiedAt;
    }

    this.languagePolicy.normalizeEntry(entry);

    if (entry.status === "stub" && this.hasLexicalUpdate(updateData)) {
      entry.status = "active";
    }

    if (entry.status === "stub") {
      delete entry.memory;
    } else if (!entry.memory) {
      entry.memory = this.studyMemory.initialMemory(now);
    }

    entry.meta.modifiedAt = now;

    return entry;
  }

  create(data: CreateVocabEntry): Result {
    const now = this.deps.nowIso();

    try {
      const entry = this.db.transaction(() => {
        const { entry: created, relatedTokens } = this.buildEntryFromCreateData(data, now);
        validateSenseCue(
          formatDisplayTerm(created),
          created.senseCue,
          this.findByLemma(created.lemma),
        );
        this.persistEntry(created, "insert");
        if (relatedTokens !== undefined) {
          this.applyRelationsFromTokens(created, relatedTokens, now);
          this.pruneOrphanStubs();
        }
        return created;
      });

      return {
        success: true,
        entry: this.readEntryById(entry.id) ?? entry,
      };
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      throw new AppError("PERSISTENCE_WRITE_FAILED", { cause: error });
    }
  }

  createWithSenseCueBackfills(
    data: CreateVocabEntry,
    backfills: Array<{ id: number; expectedRevision: number; senseCue: string }>,
  ): Result {
    const now = this.deps.nowIso();
    try {
      return this.db.transaction<Result>(() => {
        const dedupedBackfills = new Map<number, { expectedRevision: number; senseCue: string }>();
        for (const backfill of backfills) {
          if (!Number.isFinite(backfill.id) || backfill.id <= 0) {
            continue;
          }
          dedupedBackfills.set(Math.trunc(backfill.id), backfill);
        }

        for (const [id, { expectedRevision, senseCue }] of dedupedBackfills.entries()) {
          const currentEntry = this.readEntryById(id);
          if (!currentEntry) {
            // Throwing rolls back backfills already written in this transaction.
            throw new MissingBackfillTargetError();
          }
          if (currentEntry.revision !== expectedRevision) {
            throw new AppError("REVISION_CONFLICT", {
              context: { id, currentRevision: currentEntry.revision },
            });
          }
          if (
            normalizeAliasText(currentEntry.lemma) !==
            normalizeAliasText(parseTermInput(data.lemma).lemma)
          ) {
            throw new AppError("WORD_NOT_FOUND_BY_ID", {
              context: { id, operation: "create backfill" },
            });
          }

          const entry = cloneEntry(currentEntry);
          if (senseCue.trim()) {
            entry.senseCue = senseCue;
          } else {
            delete entry.senseCue;
          }

          this.languagePolicy.normalizeEntry(entry);

          if (entry.status === "stub" && this.hasLexicalUpdate({ senseCue })) {
            entry.status = "active";
          }

          if (entry.status === "stub") {
            delete entry.memory;
          } else if (!entry.memory) {
            entry.memory = this.studyMemory.initialMemory(now);
          }

          entry.meta.modifiedAt = now;
          entry.revision = (currentEntry.revision ?? 1) + 1;
          this.persistEntry(entry);
        }

        const { entry: createdEntry, relatedTokens } = this.buildEntryFromCreateData(data, now);
        validateSenseCue(
          formatDisplayTerm(createdEntry),
          createdEntry.senseCue,
          this.findByLemma(createdEntry.lemma),
        );
        this.persistEntry(createdEntry, "insert");

        if (relatedTokens !== undefined) {
          this.applyRelationsFromTokens(createdEntry, relatedTokens, now);
          this.pruneOrphanStubs();
        }

        return {
          success: true,
          entry: this.readEntryById(createdEntry.id) ?? createdEntry,
        };
      });
    } catch (error) {
      if (error instanceof MissingBackfillTargetError) {
        return { success: false, found: false };
      }
      if (isAppError(error)) {
        throw error;
      }
      throw new AppError("PERSISTENCE_WRITE_FAILED", { cause: error });
    }
  }

  updateById(id: number, updateData: UpdateVocabEntry): Result {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, found: false };
    }

    const now = this.deps.nowIso();
    const entryId = Math.trunc(id);

    try {
      return this.db.transaction<Result>(() => {
        const currentEntry = this.readEntryById(entryId);
        if (!currentEntry) {
          return { success: false, found: false };
        }
        if (
          updateData.expectedRevision !== undefined &&
          updateData.expectedRevision !== currentEntry.revision
        ) {
          throw new AppError("REVISION_CONFLICT", {
            context: { id: entryId, currentRevision: currentEntry.revision },
          });
        }

        const updatedEntry = this.applyUpdateData(currentEntry, updateData, now);
        updatedEntry.revision = (currentEntry.revision ?? 1) + 1;
        this.persistEntry(updatedEntry);

        if (updateData.relatedTokens !== undefined) {
          this.applyRelationsFromTokens(updatedEntry, updateData.relatedTokens, now);
          this.pruneOrphanStubs();
        }

        return {
          success: true,
          found: true,
          entry: this.readEntryById(updatedEntry.id) ?? updatedEntry,
        };
      });
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      throw new AppError("PERSISTENCE_WRITE_FAILED", { cause: error });
    }
  }

  deleteById(id: number, expectedRevision?: number): Result {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, found: false };
    }

    const entryId = Math.trunc(id);

    try {
      return this.db.transaction<Result>(() => {
        const deletedEntry = this.readEntryById(entryId);
        if (!deletedEntry) {
          return { success: false, found: false };
        }
        if (expectedRevision !== undefined && expectedRevision !== deletedEntry.revision) {
          throw new AppError("REVISION_CONFLICT", {
            context: { id: entryId, currentRevision: deletedEntry.revision },
          });
        }

        this.db.run(sql`DELETE FROM entries WHERE id = ${entryId}`);
        this.pruneOrphanStubs();

        return {
          success: true,
          found: true,
          entry: deletedEntry,
        };
      });
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError("PERSISTENCE_WRITE_FAILED", { cause: error });
    }
  }
}
