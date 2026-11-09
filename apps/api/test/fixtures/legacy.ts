import { writeFileSync } from "node:fs";

/**
 * A schema-v2 log as the legacy session logger wrote it: `sortResult` after the reviews,
 * two-space JSON and a trailing newline. Review 9 references an entry deleted before migration.
 */
export const legacySessionId = "18f2a3b4c5d-1a2b3c4d";

export function legacyLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    sessionId: legacySessionId,
    startedAt: "2024-04-05T12:00:00.000Z",
    selection: { type: "top", maxWords: 2 },
    reviews: [
      {
        id: 1,
        term: "bank",
        priority: 0.75,
        reviewedAt: "2024-04-05T12:00:03.000Z",
        before: { strength: 2, difficulty: 3, streak: 1, lastReviewed: "2024-04-04T12:00:00.000Z" },
        after: { strength: 2.5, difficulty: 3.1, streak: 2 },
        internals: { answerTime: 1200, answerScore: 1, speedScore: 0.4 },
      },
      {
        id: 9,
        term: "verdwenen",
        priority: 0.5,
        reviewedAt: "2024-04-05T12:00:06.000Z",
        before: { strength: 1, difficulty: 2, streak: 0, lastReviewed: "2024-04-05T12:00:00.000Z" },
        after: { strength: 1, difficulty: 2.2, streak: 0 },
        internals: { answerTime: 3000, answerScore: 0 },
      },
    ],
    sortResult: [
      { id: 1, term: "bank", priority: 0.75 },
      { id: 9, term: "verdwenen", priority: 0.5 },
    ],
    endedAt: "2024-04-05T12:00:07.000Z",
    stats: {
      totalWords: 2,
      wordsReviewed: 2,
      veryKnowCount: 0,
      knowCount: 1,
      clueCount: 0,
      cluesCount: 0,
      noCount: 1,
    },
    outcome: { status: "quit" },
    ...overrides,
  };
}

export const legacyLogText = (log: Record<string, unknown> = legacyLog()) =>
  JSON.stringify(log, null, 2) + "\n";

export function createLegacyLogs(path: string, log?: Record<string, unknown>): void {
  writeFileSync(path, legacyLogText(log));
}
