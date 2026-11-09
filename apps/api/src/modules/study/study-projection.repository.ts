import { Injectable } from "@nestjs/common";
import { and, gte, inArray, lte, ne, sql } from "drizzle-orm";

import { Database } from "../../infra/db/database.js";
import type { VocabEntry } from "../vocabulary/vocab.types.js";
import { entriesTable } from "../vocabulary/vocabulary.schema.js";
import { VocabularyService } from "../vocabulary/vocabulary.service.js";
import type { StudyPrioritySeed, StudyRepositoryPort } from "./repository.types.js";

/** Study selection joins lexical inventory with memory; vocabulary remains the entry reader. */
@Injectable()
export class StudyProjectionRepository implements StudyRepositoryPort {
  private readonly db: Database["orm"];

  constructor(
    database: Database,
    private readonly vocabulary: VocabularyService,
  ) {
    this.db = database.orm;
  }

  getActiveInventory(): {
    totalWords: number;
    minId: number;
    maxId: number;
  } {
    const row = this.db.get<{ totalWords: number; minId: number | null; maxId: number | null }>(sql`
        SELECT COUNT(*) AS totalWords, MIN(id) AS minId, MAX(id) AS maxId
        FROM entries
        WHERE status != 'stub'
      `) ?? {
      totalWords: 0,
      minId: null,
      maxId: null,
    };

    return {
      totalWords: row.totalWords,
      minId: row.minId ?? 0,
      maxId: row.maxId ?? 0,
    };
  }

  streamActivePrioritySeeds(): Iterable<StudyPrioritySeed> {
    const rows = this.db.all<{
      id: number;
      strength: number | null;
      difficulty: number | null;
      streak: number | null;
      lastReviewed: string | null;
    }>(sql`
      SELECT
        e.id AS id,
        m.strength AS strength,
        m.difficulty AS difficulty,
        m.streak AS streak,
        m.last_reviewed AS lastReviewed
      FROM entries e
      LEFT JOIN study_memory m ON m.entry_id = e.id
      WHERE e.status != 'stub'
      ORDER BY e.id ASC
    `);

    return {
      [Symbol.iterator]: function* () {
        for (const row of rows) {
          yield {
            id: row.id,
            ...(row.strength !== null &&
            row.difficulty !== null &&
            row.streak !== null &&
            row.lastReviewed !== null
              ? {
                  memory: {
                    strength: row.strength,
                    difficulty: row.difficulty,
                    streak: row.streak,
                    lastReviewed: row.lastReviewed,
                  },
                }
              : {}),
          } satisfies StudyPrioritySeed;
        }
      },
    };
  }

  findActiveByIds(ids: number[]): VocabEntry[] {
    if (ids.length === 0) {
      return [];
    }

    const rows = this.db
      .select({
        id: entriesTable.id,
      })
      .from(entriesTable)
      .where(and(ne(entriesTable.status, "stub"), inArray(entriesTable.id, ids)))
      .all();

    const rowIds = rows.map((row) => row.id);
    const entries = this.vocabulary.findEntriesByIds(rowIds);
    const byId = new Map<number, VocabEntry>(entries.map((entry) => [entry.id, entry]));

    return ids.map((id) => byId.get(id)).filter((entry): entry is VocabEntry => Boolean(entry));
  }

  findActiveInRange(startId: number, endId: number): VocabEntry[] {
    if (!Number.isFinite(startId) || !Number.isFinite(endId) || startId > endId) {
      return [];
    }

    const normalizedStartId = Math.trunc(startId);
    const normalizedEndId = Math.trunc(endId);
    const rows = this.db
      .select({
        id: entriesTable.id,
      })
      .from(entriesTable)
      .where(
        and(
          ne(entriesTable.status, "stub"),
          gte(entriesTable.id, normalizedStartId),
          lte(entriesTable.id, normalizedEndId),
        ),
      )
      .orderBy(entriesTable.id)
      .all();

    return this.vocabulary.findEntriesByIds(rows.map((row) => row.id));
  }
}
