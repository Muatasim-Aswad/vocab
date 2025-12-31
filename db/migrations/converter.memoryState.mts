import type { Vocab } from "../../src/data/repository.mts";
import type { MigrationArgs, MigrationContext } from "./migrate.mts";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_STRENGTH,
} from "../../src/data/memory/memory.mjs";

type AnyRecord = Record<string, unknown>;

export function convert(
  entry: Vocab,
  args: MigrationArgs,
  ctx: MigrationContext,
) {
  const next: AnyRecord = { ...(entry as unknown as AnyRecord) };

  const keepLastReviewed = args.keepLastReviewed === true;

  const oldLastReviewed = (entry as unknown as { lastReviewed?: unknown })
    .lastReviewed;

  delete (next as { memorizationStrength?: unknown }).memorizationStrength;
  delete (next as { lastReviewed?: unknown }).lastReviewed;

  next.memoryStrength = DEFAULT_STRENGTH;
  next.memoryDifficulty = DEFAULT_DIFFICULTY;
  next.memoryStreak = 0;

  const createdAt =
    typeof next.addedAt === "string" && next.addedAt.trim()
      ? next.addedAt
      : ctx.nowIso;

  const existingMemoryLastReviewed =
    typeof next.memoryLastReviewed === "string" &&
    next.memoryLastReviewed.trim()
      ? next.memoryLastReviewed
      : undefined;

  if (
    keepLastReviewed &&
    typeof oldLastReviewed === "string" &&
    oldLastReviewed.trim()
  ) {
    next.memoryLastReviewed = oldLastReviewed;
  } else {
    next.memoryLastReviewed = existingMemoryLastReviewed ?? createdAt;
  }

  next.modifiedAt = ctx.nowIso;

  return next;
}

export default convert;
