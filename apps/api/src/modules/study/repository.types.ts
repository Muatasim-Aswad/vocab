import type { VocabEntry } from "../vocabulary/vocab.types.js";
import type { MemoryState } from "./memory-state.js";

type ActiveStudyInventory = {
  totalWords: number;
  minId: number;
  maxId: number;
};

export type StudyPrioritySeed = {
  id: number;
  memory?: MemoryState;
};

export interface StudyRepositoryPort {
  getActiveInventory(): ActiveStudyInventory;
  streamActivePrioritySeeds(): Iterable<StudyPrioritySeed>;
  findActiveByIds(ids: number[]): VocabEntry[];
  findActiveInRange(startId: number, endId: number): VocabEntry[];
}

export type SavedReview = "saved" | "missing" | "stale";

export interface StudyMemoryPort {
  saveReview(
    entryId: number,
    memory: MemoryState,
    expectedRevision: number | undefined,
  ): SavedReview;
}
