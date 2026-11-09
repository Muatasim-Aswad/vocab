import type { NowMs } from "../../shared/clock.js";
import {
  getForgetProbability,
  getLogOverdueSignal,
  MINIMAL_REVIEW_INTERVAL_DAYS,
  MS_IN_DAY,
} from "./memory.js";

type MemoryTrackingFields = {
  memory: {
    strength: number;
    difficulty: number;
    lastReviewed: string; // ISO date string
  };
};

export function calculatePriorityValue(
  memory: {
    strength: number;
    difficulty: number;
    lastReviewed: string;
  },
  nowMs: number,
): number {
  const daysSinceLastReview = (nowMs - new Date(memory.lastReviewed).getTime()) / MS_IN_DAY;

  const strength = memory.strength;
  const difficulty = memory.difficulty;

  let priority = getForgetProbability({
    strength,
    difficulty,
    daysSinceLastReview,
  });

  // Decrease if days since last review is less than the minimum review interval
  if (daysSinceLastReview < MINIMAL_REVIEW_INTERVAL_DAYS) {
    priority -= 1;
  }

  // If the word has full forgotten probability, boost its priority based on how overdue it is
  if (priority >= 1)
    priority += getLogOverdueSignal({
      strength,
      difficulty,
      daysSinceLastReview,
    });

  return priority;
}

function calculatePriority<T extends MemoryTrackingFields>(
  item: T,
  nowMs: number,
): T & { priority: number } {
  return {
    ...item,
    priority: calculatePriorityValue(item.memory, nowMs),
  };
}

export function sortByPriority<T extends MemoryTrackingFields>(
  items: T[],
  deps: { nowMs: NowMs },
): Array<T & { priority: number }> {
  const nowMs = deps.nowMs();
  const itemsWithPriority = items.map((item) => calculatePriority(item, nowMs));
  return itemsWithPriority.toSorted((a, b) => b.priority - a.priority);
}
