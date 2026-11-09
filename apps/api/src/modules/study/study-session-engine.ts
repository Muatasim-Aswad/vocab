import type { VocabEntry } from "../vocabulary/vocab.types.js";
import { buildMemoryUpdate } from "./memory-review.js";
import type { MemoryState } from "./memory-state.js";
import {
  AnswerScore,
  DEFAULT_DIFFICULTY,
  DEFAULT_STRENGTH,
  type MemoryInternals,
} from "./memory.js";
import { calculatePriorityValue, sortByPriority } from "./priority.js";
import type {
  StudyMemoryPort,
  StudyPrioritySeed,
  StudyRepositoryPort,
} from "./repository.types.js";
import type { StudySessionSelection } from "./session.types.js";
import { StudyError as AppError } from "./study-error.js";

export interface StudyStats {
  totalWords: number;
  wordsReviewed: number;
  veryKnowCount: number;
  knowCount: number;
  clueCount: number;
  cluesCount: number;
  noCount: number;
}

export interface WordWithPriority extends VocabEntry {
  priority: number | null;
}

export function createStudyStats(totalWords: number): StudyStats {
  return {
    totalWords,
    wordsReviewed: 0,
    veryKnowCount: 0,
    knowCount: 0,
    clueCount: 0,
    cluesCount: 0,
    noCount: 0,
  };
}

export function updateStatsForAnswer(stats: StudyStats, answerScore: AnswerScore): void {
  stats.wordsReviewed++;
  if (answerScore === AnswerScore.VERY_KNOW) stats.veryKnowCount++;
  else if (answerScore === AnswerScore.KNOW) stats.knowCount++;
  else if (answerScore === AnswerScore.CLUE) stats.clueCount++;
  else if (answerScore === AnswerScore.CLUES) stats.cluesCount++;
  else if (answerScore === AnswerScore.NO) stats.noCount++;
}

export function isStrongAnswer(answerScore: AnswerScore): boolean {
  return answerScore === AnswerScore.VERY_KNOW || answerScore === AnswerScore.KNOW;
}

type PrepareStudySessionRepo = Pick<
  StudyRepositoryPort,
  "getActiveInventory" | "streamActivePrioritySeeds" | "findActiveByIds" | "findActiveInRange"
>;
type StudyInventoryRepo = Pick<StudyRepositoryPort, "getActiveInventory">;

export type PreparedStudySession = {
  sessionWords: WordWithPriority[];
  selection: StudySessionSelection;
};

type PriorityCandidate = {
  id: number;
  priority: number;
};

function withMemory(
  entry: VocabEntry,
  nowMs: number,
): VocabEntry & {
  memory: {
    strength: number;
    difficulty: number;
    streak: number;
    lastReviewed: string;
  };
} {
  return {
    ...entry,
    memory: {
      strength: entry.memory?.strength ?? DEFAULT_STRENGTH,
      difficulty: entry.memory?.difficulty ?? DEFAULT_DIFFICULTY,
      streak: entry.memory?.streak ?? 0,
      lastReviewed: entry.memory?.lastReviewed ?? new Date(nowMs).toISOString(),
    },
  };
}

function isWorsePriority(left: PriorityCandidate, right: PriorityCandidate): boolean {
  if (left.priority !== right.priority) {
    return left.priority < right.priority;
  }

  return left.id > right.id;
}

function isBetterPriority(left: PriorityCandidate, right: PriorityCandidate): boolean {
  if (left.priority !== right.priority) {
    return left.priority > right.priority;
  }

  return left.id < right.id;
}

function siftUp(heap: PriorityCandidate[], index: number): void {
  let current = index;
  while (current > 0) {
    const parent = Math.floor((current - 1) / 2);
    if (!isWorsePriority(heap[current]!, heap[parent]!)) {
      break;
    }

    [heap[current], heap[parent]] = [heap[parent]!, heap[current]!];
    current = parent;
  }
}

function siftDown(heap: PriorityCandidate[], index: number): void {
  let current = index;

  while (true) {
    const left = current * 2 + 1;
    const right = current * 2 + 2;
    let next = current;

    if (left < heap.length && isWorsePriority(heap[left]!, heap[next]!)) {
      next = left;
    }

    if (right < heap.length && isWorsePriority(heap[right]!, heap[next]!)) {
      next = right;
    }

    if (next === current) {
      return;
    }

    [heap[current], heap[next]] = [heap[next]!, heap[current]!];
    current = next;
  }
}

function pushHeap(heap: PriorityCandidate[], candidate: PriorityCandidate): void {
  heap.push(candidate);
  siftUp(heap, heap.length - 1);
}

function replaceWorst(heap: PriorityCandidate[], candidate: PriorityCandidate): void {
  heap[0] = candidate;
  siftDown(heap, 0);
}

function selectTopPriorityCandidates(
  seeds: Iterable<StudyPrioritySeed>,
  maxWords: number,
  nowMs: number,
): PriorityCandidate[] {
  const effectiveLimit = Math.max(1, maxWords);
  const heap: PriorityCandidate[] = [];
  const nowIso = new Date(nowMs).toISOString();
  const seenIds = new Set<number>();

  for (const seed of seeds) {
    if (!Number.isFinite(seed.id) || seed.id <= 0 || seenIds.has(seed.id)) {
      continue;
    }

    seenIds.add(seed.id);

    const priority = calculatePriorityValue(
      {
        strength: seed.memory?.strength ?? DEFAULT_STRENGTH,
        difficulty: seed.memory?.difficulty ?? DEFAULT_DIFFICULTY,
        lastReviewed: seed.memory?.lastReviewed ?? nowIso,
      },
      nowMs,
    );

    const candidate: PriorityCandidate = { id: seed.id, priority };
    if (heap.length < effectiveLimit) {
      pushHeap(heap, candidate);
      continue;
    }

    if (isBetterPriority(candidate, heap[0]!)) {
      replaceWorst(heap, candidate);
    }
  }

  return heap.toSorted((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return left.id - right.id;
  });
}

export function prepareStudySession(
  repo: PrepareStudySessionRepo,
  params: {
    maxWords: number;
    nowMs: number;
    startId?: number;
    endId?: number;
  },
): PreparedStudySession {
  const inventory = repo.getActiveInventory();
  if (inventory.totalWords === 0) {
    throw new AppError("VOCAB_EMPTY", {
      context: {
        operation: "study",
      },
    });
  }

  if (params.startId !== undefined) {
    const resolvedEndId = params.endId ?? inventory.maxId;
    const rangeEntries = repo.findActiveInRange(params.startId, resolvedEndId);
    if (rangeEntries.length === 0) {
      throw new AppError("INVALID_ID_RANGE", {
        context: {
          operation: "study",
          errorMessage: `Invalid id range: ids ${params.startId} to ${resolvedEndId}. Total words available: ${inventory.totalWords}`,
        },
      });
    }

    const sessionWords = sortByPriority(
      rangeEntries.map((entry) => withMemory(entry, params.nowMs)),
      {
        nowMs: () => params.nowMs,
      },
    ) as WordWithPriority[];

    return {
      sessionWords,
      selection: { type: "range", startId: params.startId, endId: resolvedEndId } as const,
    };
  }

  const selected = selectTopPriorityCandidates(
    repo.streamActivePrioritySeeds(),
    params.maxWords,
    params.nowMs,
  );
  const selectedEntries = repo.findActiveByIds(selected.map((candidate) => candidate.id));
  const entriesById = new Map<number, VocabEntry>(
    selectedEntries.map((entry) => [entry.id, entry]),
  );

  const sessionWords: WordWithPriority[] = [];
  for (const candidate of selected) {
    const entry = entriesById.get(candidate.id);
    if (!entry) {
      continue;
    }

    sessionWords.push({
      ...entry,
      priority: candidate.priority,
      memory: {
        strength: entry.memory?.strength ?? DEFAULT_STRENGTH,
        difficulty: entry.memory?.difficulty ?? DEFAULT_DIFFICULTY,
        streak: entry.memory?.streak ?? 0,
        lastReviewed: entry.memory?.lastReviewed ?? new Date(params.nowMs).toISOString(),
      },
    });
  }

  return {
    sessionWords,
    selection: { type: "top", maxWords: params.maxWords } as const,
  };
}

export type PersistStudyReviewResult = {
  review: {
    id: number;
    term: string;
    priority: number | null;
    reviewedAt: string;
    internals?: MemoryInternals;
  };
  memory: MemoryState;
};

export function persistStudyReview(
  memoryStore: StudyMemoryPort,
  params: {
    entry: WordWithPriority;
    answerScore: AnswerScore;
    answerTime: number;
    nowMs: number;
  },
): PersistStudyReviewResult {
  const { update, review } = buildMemoryUpdate(params);
  const saved = memoryStore.saveReview(params.entry.id, update.memory, params.entry.revision);
  if (saved === "stale") {
    throw new AppError("REVISION_CONFLICT", {
      context: { id: params.entry.id, expectedRevision: params.entry.revision },
    });
  }
  if (saved === "missing") {
    throw new AppError("PERSISTENCE_WRITE_FAILED", {
      context: {
        operation: "study",
        id: params.entry.id,
      },
    });
  }

  return { review, memory: update.memory };
}

export type StudyInventory = {
  totalWords: number;
  minId: number;
  maxId: number;
};

export function getStudyInventory(repo: StudyInventoryRepo): StudyInventory {
  const inventory = repo.getActiveInventory();
  if (inventory.totalWords === 0) {
    throw new AppError("VOCAB_EMPTY", {
      context: {
        operation: "study",
      },
    });
  }

  return inventory;
}
