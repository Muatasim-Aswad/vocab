import { Injectable } from "@nestjs/common";

import type { MemoryState } from "./memory-state.js";
import { DEFAULT_DIFFICULTY, DEFAULT_STRENGTH } from "./memory.js";
import { StudyMemoryRepository } from "./study-memory.repository.js";

/** Owns the initial memory lifecycle shared with lexical entry creation and activation. */
@Injectable()
export class StudyMemoryService {
  constructor(private readonly repository: StudyMemoryRepository) {}

  initialMemory(now: string): MemoryState {
    return {
      strength: DEFAULT_STRENGTH,
      difficulty: DEFAULT_DIFFICULTY,
      streak: 0,
      lastReviewed: now,
    };
  }

  syncEntry(id: number, status: string, now: string): void {
    const memory = status === "stub" ? null : this.initialMemory(now);
    this.repository.syncEntry(id, memory);
  }

  findByIds(ids: number[]): Map<number, MemoryState> {
    return this.repository.findByIds(ids);
  }
}
