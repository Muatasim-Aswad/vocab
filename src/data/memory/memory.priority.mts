import {
  getForgetProbability,
  getLogOverdueSignal,
  MS_IN_DAY,
} from "./memory.mjs";

export type MemoryTrackingFields = {
  memoryStrength: number;
  memoryDifficulty: number;
  memoryLastReviewed: string; // ISO date string
};

export function calculatePriority<T extends MemoryTrackingFields>(
  item: T,
): T & { priority: number } {
  const daysSinceLastReview =
    (Date.now() - new Date(item.memoryLastReviewed).getTime()) / MS_IN_DAY;

  const strength = item.memoryStrength;
  const difficulty = item.memoryDifficulty;

  let priority = getForgetProbability({
    strength,
    difficulty,
    daysSinceLastReview,
  });

  if (priority >= 1)
    priority += getLogOverdueSignal({
      strength,
      difficulty,
      daysSinceLastReview,
    });

  return { ...item, priority };
}

export function sortByPriority<T extends MemoryTrackingFields>(
  items: T[],
): Array<T & { priority: number }> {
  const itemsWithPriority = items.map(calculatePriority);
  return itemsWithPriority.sort((a, b) => b.priority - a.priority);
}
