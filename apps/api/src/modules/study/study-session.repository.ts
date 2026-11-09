import { Injectable } from "@nestjs/common";
import { entry, studyHistoryDocument, studySession } from "@vocab/contracts";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

import { Database } from "../../infra/db/database.js";
import { AppError } from "../../shared/app-error.js";
import type { PreparedStudySession, StudyStats } from "./study-session-engine.js";
import { studySessionsTable } from "./study.schema.js";

export type StudySessionState = PreparedStudySession & {
  nextIndex: number;
  stats: StudyStats;
  reviews: Array<{
    id: number;
    term: string;
    priority: number | null;
    reviewedAt: string;
    before: { strength: number; difficulty: number; streak: number; lastReviewed: string };
    after: { strength: number; difficulty: number; streak: number };
    internals: {
      answerScore: number;
      answerTime: number;
      currentForgetProbability?: number;
      expectedAnswerTime?: number;
      speedScore?: number;
      streakBonus?: number;
      answerQuality?: number;
    };
  }>;
  weakEntryIds?: number[];
};

const memoryBefore = z.looseObject({
  strength: z.number(),
  difficulty: z.number(),
  streak: z.number(),
  lastReviewed: z.string(),
});
const memoryAfter = memoryBefore.omit({ lastReviewed: true });
const storedState = z.looseObject({
  sessionWords: z.array(
    entry.loose().extend({
      revision: entry.shape.revision.optional(),
      priority: z.number().nullable(),
      meta: entry.shape.meta.loose(),
      memory: entry.shape.memory.unwrap().loose().optional(),
      relations: z.array(entry.shape.relations.unwrap().element.loose()).optional(),
    }),
  ),
  selection: z.union([
    z.looseObject({ type: z.literal("top"), maxWords: z.number() }),
    z.looseObject({ type: z.literal("range"), startId: z.number(), endId: z.number().optional() }),
  ]),
  nextIndex: z.number(),
  stats: studySession.shape.stats.loose(),
  reviews: z.array(
    z.looseObject({
      id: z.number(),
      term: z.string(),
      priority: z.number().nullable(),
      reviewedAt: z.string(),
      before: memoryBefore,
      after: memoryAfter,
      internals: z.looseObject({
        answerScore: z.number(),
        answerTime: z.number(),
        currentForgetProbability: z.number().optional(),
        expectedAnswerTime: z.number().optional(),
        speedScore: z.number().optional(),
        streakBonus: z.number().optional(),
        answerQuality: z.number().optional(),
      }),
    }),
  ),
  weakEntryIds: z.array(z.number()).optional(),
});

// Pre-history sessions retain fewer fields than resumable current sessions.
const historyState = z.looseObject({
  sessionWords: z.array(
    z.looseObject({
      id: z.number(),
      lemma: z.string(),
      priority: z.number().nullable(),
    }),
  ),
  selection: z.looseObject({}),
  stats: z.looseObject({}),
  reviews: studyHistoryDocument.shape.reviews,
});

export type StoredStudySession = {
  id: string;
  revision: number;
  state: StudySessionState;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
};

@Injectable()
export class StudySessionRepository {
  constructor(private readonly database: Database) {}

  create(state: StudySessionState, at: string): StoredStudySession {
    const id = uuidv7();
    this.database.orm
      .insert(studySessionsTable)
      .values({ id, stateJson: JSON.stringify(state), startedAt: at, updatedAt: at })
      .run();
    return { id, revision: 1, state, startedAt: at, updatedAt: at, endedAt: null };
  }

  private row(id: string) {
    return this.database.orm
      .select()
      .from(studySessionsTable)
      .where(eq(studySessionsTable.id, id))
      .get();
  }

  findById(id: string): StoredStudySession | null {
    const row = this.row(id);
    return row
      ? {
          id: row.id,
          revision: row.revision,
          state: storedState.parse(JSON.parse(row.stateJson)),
          startedAt: row.startedAt,
          updatedAt: row.updatedAt,
          endedAt: row.endedAt,
        }
      : null;
  }

  findForHistory(id: string) {
    const row = this.row(id);
    return row
      ? {
          id: row.id,
          state: historyState.parse(JSON.parse(row.stateJson)),
          startedAt: row.startedAt,
          endedAt: row.endedAt,
        }
      : null;
  }

  update(
    id: string,
    expectedRevision: number,
    state: StudySessionState,
    at: string,
    endedAt?: string,
  ): StoredStudySession {
    const result = this.database.sqlite
      .prepare(
        "UPDATE study_sessions SET state_json = ?, revision = revision + 1, updated_at = ?, ended_at = COALESCE(?, ended_at) WHERE id = ? AND revision = ? AND ended_at IS NULL",
      )
      .run(JSON.stringify(state), at, endedAt ?? null, id, expectedRevision);
    if (result.changes !== 1)
      throw new AppError("conflict", {
        message: "Study session changed since it was read",
        reason: "STUDY_REVISION_CONFLICT",
        details: { private: { id, expectedRevision } },
      });
    return this.findById(id)!;
  }
}
