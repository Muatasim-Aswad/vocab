import { Injectable } from "@nestjs/common";

import { Database } from "../../infra/db/database.js";
import type { MemoryState } from "./memory-state.js";
import type { SavedReview, StudyMemoryPort } from "./repository.types.js";

/** Study memory is study-owned state: saving a review never changes the entry it belongs to. */
@Injectable()
export class StudyMemoryRepository implements StudyMemoryPort {
  constructor(private readonly database: Database) {}

  syncEntry(entryId: number, memory: MemoryState | null): void {
    if (memory === null) {
      this.database.sqlite.prepare("DELETE FROM study_memory WHERE entry_id = ?").run(entryId);
      return;
    }

    this.database.sqlite
      .prepare(
        `INSERT INTO study_memory (entry_id, strength, difficulty, streak, last_reviewed)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO NOTHING`,
      )
      .run(entryId, memory.strength, memory.difficulty, memory.streak, memory.lastReviewed);
  }

  findByIds(ids: number[]): Map<number, MemoryState> {
    if (!ids.length) return new Map();

    const placeholders = ids.map(() => "?").join(",");
    const rows = this.database.sqlite
      .prepare<number[], MemoryState & { id: number }>(
        `SELECT entry_id AS id, strength, difficulty, streak, last_reviewed AS lastReviewed
         FROM study_memory WHERE entry_id IN (${placeholders})`,
      )
      .all(...ids);

    return new Map(rows.map(({ id, ...memory }) => [id, memory]));
  }

  /** Saves memory only while the entry is active and, when given, at the revision that was studied. */
  saveReview(
    entryId: number,
    memory: MemoryState,
    expectedRevision: number | undefined,
  ): SavedReview {
    const saved = this.database.sqlite
      .prepare(
        `INSERT INTO study_memory (entry_id, strength, difficulty, streak, last_reviewed)
         SELECT id, ?, ?, ?, ? FROM entries
         WHERE id = ? AND status = 'active' AND (? IS NULL OR revision = ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           strength = excluded.strength,
           difficulty = excluded.difficulty,
           streak = excluded.streak,
           last_reviewed = excluded.last_reviewed`,
      )
      .run(
        memory.strength,
        memory.difficulty,
        memory.streak,
        memory.lastReviewed,
        entryId,
        expectedRevision ?? null,
        expectedRevision ?? null,
      );
    if (saved.changes === 1) return "saved";
    const current = this.database.sqlite
      .prepare("SELECT 1 FROM entries WHERE id = ? AND status = 'active'")
      .get(entryId);
    return current ? "stale" : "missing";
  }
}
