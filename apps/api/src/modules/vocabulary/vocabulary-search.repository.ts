import { sql } from "drizzle-orm";

import type { Database } from "../../infra/db/database.js";
import type {
  EntryListOrder,
  PaginatedVocabEntryResult,
  SearchQueryOptions,
  VocabEntry,
} from "./vocab.types.js";

export const TYPE_FILTER_SQL_FUNCTION = "vocab_matches_type_filter";

function orderClause(order: EntryListOrder = "added") {
  if (order === "modified") return sql`e.modified_at DESC, e.id DESC`;
  if (order === "alphabetical") return sql`e.lemma COLLATE NOCASE, e.id`;
  return sql`e.id DESC`;
}

function toLikePattern(query: string): string {
  const withSqlWildcard = query
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("*", "%");
  if (query.includes("*")) {
    return withSqlWildcard;
  }
  return `${withSqlWildcard}%`;
}

function normalizePagination(options?: { cursor?: number; limit?: number }): {
  cursor: number;
  limit: number;
  offset: number;
} {
  const page =
    typeof options?.cursor === "number" && Number.isFinite(options.cursor) && options.cursor > 0
      ? Math.trunc(options.cursor)
      : 1;
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.trunc(options.limit)
      : 10;

  return {
    cursor: page,
    limit,
    offset: (page - 1) * limit,
  };
}

/** SQL search and pagination over lexical aliases and entry fields. */
export class VocabularySearchRepository {
  constructor(
    private readonly db: Database["orm"],
    private readonly readEntries: (ids: number[]) => VocabEntry[],
  ) {}

  private buildTypeFilterClause(options?: { typeFilter?: string }) {
    const normalizedFilter = options?.typeFilter?.trim().toLowerCase();
    if (!normalizedFilter) {
      return {
        clause: sql``,
      };
    }

    return {
      clause: sql`
        AND ${sql.raw(TYPE_FILTER_SQL_FUNCTION)}(
          ${normalizedFilter}, e.id, e.lemma, e.language_code, e.is_multi_word,
          e.part_of_speech, e.construction_type, e.grammar_json, e.tags_json
        ) = 1`,
    };
  }

  search(query: string, options: SearchQueryOptions = {}): PaginatedVocabEntryResult {
    const { cursor, limit, offset } = normalizePagination(options);
    const likePattern = toLikePattern(query);
    const { clause: typeFilterClause } = this.buildTypeFilterClause({
      typeFilter: options.typeFilter,
    });

    const scopes = [
      sql`SELECT e.id AS entry_id, 1 AS rank
          FROM entries e
          JOIN entry_aliases a ON a.entry_id = e.id
          WHERE a.alias LIKE ${likePattern} ESCAPE '\\'
            AND a.kind IN ('lemma', 'variant', 'manual')${typeFilterClause}`,
      sql`SELECT e.id AS entry_id, 2 AS rank
          FROM entries e
          JOIN entry_aliases a ON a.entry_id = e.id
          WHERE a.alias LIKE ${likePattern} ESCAPE '\\'
            AND a.kind = 'form'${typeFilterClause}`,
      sql`SELECT e.id AS entry_id, 3 AS rank
          FROM entries e
          JOIN entry_relations r ON r.source_entry_id = e.id
          JOIN entry_aliases ta ON ta.entry_id = r.target_entry_id
          WHERE ta.alias LIKE ${likePattern} ESCAPE '\\'${typeFilterClause}`,
    ];

    if (options.includeAllFields) {
      scopes.push(
        sql`SELECT e.id AS entry_id, 4 AS rank
            FROM entries e
            WHERE e.examples_json LIKE ${likePattern} ESCAPE '\\'${typeFilterClause}`,
      );
      scopes.push(
        sql`SELECT e.id AS entry_id, 5 AS rank
            FROM entries e
            WHERE e.collocations_json LIKE ${likePattern} ESCAPE '\\'${typeFilterClause}`,
      );
    }

    const candidatesSql = sql.join(scopes, sql`\nUNION ALL\n`);

    const countRow = this.db.get<{ count: number }>(sql`
      WITH candidates AS (
        ${candidatesSql}
      ),
      ranked AS (
        SELECT entry_id, MIN(rank) AS rank
        FROM candidates
        GROUP BY entry_id
      )
      SELECT COUNT(*) AS count
      FROM ranked
    `);
    const total = countRow?.count ?? 0;

    const idRows = this.db.all<{ entry_id: number }>(sql`
      WITH candidates AS (
        ${candidatesSql}
      ),
      ranked AS (
        SELECT entry_id, MIN(rank) AS rank
        FROM candidates
        GROUP BY entry_id
      ),
      ordered AS (
        SELECT
          ranked.entry_id,
          ranked.rank,
          COALESCE(
            (
              SELECT alias
              FROM entry_aliases ea
              WHERE ea.entry_id = ranked.entry_id
                AND ea.kind = 'variant'
              ORDER BY alias ASC
              LIMIT 1
            ),
            (
              SELECT LOWER(lemma)
              FROM entries e2
              WHERE e2.id = ranked.entry_id
            )
          ) AS sort_key
        FROM ranked
      )
      SELECT ordered.entry_id AS entry_id
      FROM ordered
      ORDER BY ordered.rank ASC, ordered.sort_key ASC, ordered.entry_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const ids = idRows.map((row) => row.entry_id);
    const entries = this.readEntries(ids);

    return {
      entries,
      cursor,
      limit,
      total,
      startIndex: offset,
      endIndex: offset + entries.length,
    };
  }

  paginate(options?: {
    cursor?: number;
    limit?: number;
    typeFilter?: string;
    order?: EntryListOrder;
  }): PaginatedVocabEntryResult {
    const { cursor, limit, offset } = normalizePagination(options);
    const { clause: typeFilterClause } = this.buildTypeFilterClause({
      typeFilter: options?.typeFilter,
    });

    const countRow = this.db.get<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM entries e
      WHERE e.status != 'stub'${typeFilterClause}
    `);
    const total = countRow?.count ?? 0;

    const idRows = this.db.all<{ id: number }>(sql`
      SELECT e.id AS id
      FROM entries e
      WHERE e.status != 'stub'${typeFilterClause}
      ORDER BY ${orderClause(options?.order)}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const entries = this.readEntries(idRows.map((row) => row.id));

    return {
      entries,
      cursor,
      limit,
      total,
      startIndex: offset,
      endIndex: offset + entries.length,
    };
  }
}
