import type { VocabEntry } from "../vocabulary/vocab.types.js";
import { formatDisplayTerm } from "../vocabulary/word-normalization.js";
import { AnswerScore, getNewStateWithDefaults, type MemoryInternals } from "./memory.js";

type WordWithPriority = VocabEntry & {
  priority: number | null;
};

export function buildMemoryUpdate(params: {
  entry: WordWithPriority;
  answerScore: AnswerScore;
  answerTime: number;
  nowMs: number;
}): {
  update: {
    memory: {
      strength: number;
      difficulty: number;
      streak: number;
      lastReviewed: string;
    };
  };
  review: {
    id: number;
    term: string;
    priority: number | null;
    reviewedAt: string;
    internals?: MemoryInternals;
  };
} {
  const { entry, answerScore, answerTime, nowMs } = params;
  const nowIso = new Date(nowMs).toISOString();
  const memory = entry.memory;
  const parsedLastReviewedMs = Date.parse(memory?.lastReviewed ?? "");
  const lastReviewedMs = Number.isFinite(parsedLastReviewedMs) ? parsedLastReviewedMs : nowMs;
  const msSinceLastReview = Math.max(0, nowMs - lastReviewedMs);
  const strength =
    typeof memory?.strength === "number" && Number.isFinite(memory.strength) ? memory.strength : 0;
  const difficulty =
    typeof memory?.difficulty === "number" && Number.isFinite(memory.difficulty)
      ? memory.difficulty
      : 0;
  const streak =
    typeof memory?.streak === "number" && Number.isFinite(memory.streak) ? memory.streak : 0;
  const displayTerm = formatDisplayTerm(entry);

  let memoryInternals: MemoryInternals | undefined;
  const { newStrength, newDifficulty, newStreak } = getNewStateWithDefaults(
    {
      answerScore,
      answerTime,
      itemLength: Math.max(1, displayTerm.length),
      strength,
      msSinceLastReview,
      difficulty,
      streak,
    },
    (internals) => {
      memoryInternals = internals;
    },
  );

  return {
    update: {
      memory: {
        strength: newStrength,
        difficulty: newDifficulty,
        streak: newStreak,
        lastReviewed: nowIso,
      },
    },
    review: {
      id: entry.id,
      term: displayTerm,
      priority: entry.priority,
      reviewedAt: nowIso,
      internals: memoryInternals,
    },
  };
}
