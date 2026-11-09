import { z } from "zod";

import { cursorPage } from "./pagination.ts";
import { entryId, utcTimestamp, uuidV7 } from "./primitives.ts";
import { entry, entrySummary } from "./vocabulary.ts";

export const studyStats = z.object({
  totalWords: z.int().nonnegative(),
  wordsReviewed: z.int().nonnegative(),
  veryKnowCount: z.int().nonnegative(),
  knowCount: z.int().nonnegative(),
  clueCount: z.int().nonnegative(),
  cluesCount: z.int().nonnegative(),
  noCount: z.int().nonnegative(),
});
export const studyInventory = z.object({
  totalWords: z.int().nonnegative(),
  minId: z.int().nonnegative(),
  maxId: z.int().nonnegative(),
});
const studyWord = entry.extend({ priority: z.number() });
export const studySession = z.object({
  id: uuidV7,
  revision: z.int().positive(),
  startedAt: utcTimestamp,
  updatedAt: utcTimestamp,
  endedAt: utcTimestamp.nullable(),
  nextIndex: z.int().nonnegative(),
  stats: studyStats,
  words: z.array(studyWord),
  selection: z.union([
    z.object({ type: z.literal("top"), maxWords: z.int().positive() }),
    z.object({ type: z.literal("range"), startId: entryId, endId: entryId.optional() }),
  ]),
  weakEntries: z.array(entrySummary),
});
export const startStudyBody = z.object({
  mutationId: uuidV7,
  maxWords: z.int().positive().max(10000).default(20),
  startId: entryId.optional(),
  endId: entryId.optional(),
});
export const studySessionParams = z.object({ id: uuidV7 });
export const answerStudyBody = z.object({
  mutationId: uuidV7,
  expectedRevision: z.int().positive(),
  entryId,
  answerScore: z.union([
    z.literal(0),
    z.literal(0.2),
    z.literal(0.5),
    z.literal(1),
    z.literal(1.5),
  ]),
  answerTimeMs: z.number().nonnegative().max(600000),
  hintCount: z.int().nonnegative().max(100).default(0),
});
export const answerStudyResponse = z.object({
  session: studySession,
  reviewed: entrySummary,
  reviewedAt: utcTimestamp,
});
export const endStudyBody = z.object({
  mutationId: uuidV7,
  expectedRevision: z.int().positive(),
  outcome: z.enum(["completed", "quit"]),
});

/** Stored study-history identity: a new session's UUID or an imported log's own `sessionId`. */
export const studyHistoryId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/, "Invalid study history ID");
const studyHistoryOutcome = z.enum(["completed", "quit", "error"]);
const historyReview = z.looseObject({ id: entryId });
/**
 * Schema-v2 study log: the export format for every history record. Historical fields outside
 * this shape are kept, so a record exports every field it was imported with.
 */
export const studyHistoryDocument = z.looseObject({
  schemaVersion: z.literal(2),
  sessionId: studyHistoryId,
  startedAt: utcTimestamp,
  endedAt: utcTimestamp.optional(),
  selection: z.looseObject({}),
  sortResult: z.array(z.looseObject({})).optional(),
  reviews: z.array(historyReview),
  stats: z.looseObject({}).optional(),
  outcome: z
    .looseObject({ status: studyHistoryOutcome, message: z.string().optional() })
    .optional(),
});
const studyHistorySummary = z.object({
  id: studyHistoryId,
  /** Durable study session that produced the record; `null` for imported-only history. */
  sessionId: uuidV7.nullable(),
  origin: z.enum(["api", "import"]),
  startedAt: utcTimestamp,
  endedAt: utcTimestamp.nullable(),
  /** `null` when the historical record has no outcome. */
  outcome: studyHistoryOutcome.nullable(),
  reviewCount: z.int().nonnegative(),
  recordedAt: utcTimestamp,
});
export const studyHistoryPage = cursorPage(studyHistorySummary);
export const studyHistoryRecord = studyHistorySummary.extend({ document: studyHistoryDocument });
export const studyHistoryQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const studyHistoryParams = z.object({ id: studyHistoryId });
export type StudyHistoryDocument = z.infer<typeof studyHistoryDocument>;
