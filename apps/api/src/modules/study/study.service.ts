import { Injectable } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { MutationReceipts } from "../../infra/db/mutation-receipts.js";
import { AppError } from "../../shared/app-error.js";
import { summarizeEntry } from "../vocabulary/vocabulary.service.js";
import type { AnswerScore } from "./memory.js";
import { historyRow, sessionHistoryDocument } from "./study-history.js";
import { StudyHistoryRepository, type StoredStudyHistory } from "./study-history.repository.js";
import { StudyMemoryRepository } from "./study-memory.repository.js";
import { StudyProjectionRepository } from "./study-projection.repository.js";
import { isStrongAnswer, updateStatsForAnswer } from "./study-session-engine.js";
import {
  createStudyStats,
  getStudyInventory,
  persistStudyReview,
  prepareStudySession,
  type WordWithPriority,
} from "./study-session-engine.js";
import {
  StudySessionRepository,
  type StudySessionState,
  type StoredStudySession,
} from "./study-session.repository.js";

function validateHintLimit(hintCount: number, answerScore: number): void {
  if ((hintCount === 1 && answerScore > 0.5) || (hintCount >= 2 && answerScore > 0.2))
    throw new AppError("bad_request", { message: "Answer score exceeds the hint limit" });
}

/** Study selection, review calculation and persistence are independent of HTTP transport. */
@Injectable()
export class StudyService {
  constructor(
    private readonly projection: StudyProjectionRepository,
    private readonly sessions: StudySessionRepository,
    private readonly history: StudyHistoryRepository,
    private readonly memory: StudyMemoryRepository,
    private readonly receipts: MutationReceipts,
  ) {}

  prepareStudySession(params: {
    maxWords: number;
    nowMs: number;
    startId?: number;
    endId?: number;
  }) {
    return prepareStudySession(this.projection, params);
  }

  persistStudyReview(params: {
    entry: WordWithPriority;
    answerScore: AnswerScore;
    answerTime: number;
    nowMs: number;
  }) {
    return persistStudyReview(this.memory, params);
  }

  getStudyInventory() {
    return getStudyInventory(this.projection);
  }

  startStudySession(params: { maxWords: number; nowMs: number; startId?: number; endId?: number }) {
    return this.history.transaction(() => {
      const prepared = this.prepareStudySession(params);
      const state: StudySessionState = {
        ...prepared,
        nextIndex: 0,
        stats: createStudyStats(prepared.sessionWords.length),
        reviews: [],
        weakEntryIds: [],
      };
      return this.sessions.create(state, new Date(params.nowMs).toISOString());
    });
  }

  answerStudySession(
    id: string,
    expectedRevision: number,
    entryId: number,
    answerScore: AnswerScore,
    answerTimeMs: number,
    nowMs: number,
    hintCount = 0,
  ) {
    validateHintLimit(hintCount, answerScore);
    return this.history.transaction(() =>
      this.answerInTransaction(id, expectedRevision, entryId, answerScore, answerTimeMs, nowMs),
    );
  }

  private answerInTransaction(
    id: string,
    expectedRevision: number,
    entryId: number,
    answerScore: AnswerScore,
    answerTimeMs: number,
    nowMs: number,
  ) {
    const session = this.sessions.findById(id);
    if (!session) throw new AppError("not_found", { message: "Study session not found" });
    if (session.endedAt || session.revision !== expectedRevision)
      throw new AppError("conflict", {
        message: "Study session changed since it was read",
        reason: "STUDY_REVISION_CONFLICT",
        details: { public: { currentRevision: session.revision } },
      });
    const state = structuredClone(session.state);
    const entry = state.sessionWords[state.nextIndex];
    if (!entry || entry.id !== entryId)
      throw new AppError("conflict", { message: "Study answer does not match the current entry" });
    const persisted = this.persistStudyReview({
      entry,
      answerScore,
      answerTime: answerTimeMs,
      nowMs,
    });
    updateStatsForAnswer(state.stats, answerScore);
    if (!isStrongAnswer(answerScore)) (state.weakEntryIds ??= []).push(entry.id);
    const after = persisted.memory;
    state.reviews.push({
      id: entryId,
      term: persisted.review.term,
      priority: persisted.review.priority,
      reviewedAt: persisted.review.reviewedAt,
      before: {
        strength: entry.memory?.strength ?? 1,
        difficulty: entry.memory?.difficulty ?? 2,
        streak: entry.memory?.streak ?? 0,
        lastReviewed: entry.memory?.lastReviewed ?? session.startedAt,
      },
      after: { strength: after.strength, difficulty: after.difficulty, streak: after.streak },
      internals: {
        answerScore,
        answerTime: answerTimeMs,
        currentForgetProbability: persisted.review.internals?.currentForgetProbability,
        expectedAnswerTime: persisted.review.internals?.expectedAnswerTime,
        speedScore: persisted.review.internals?.speedScore,
        streakBonus: persisted.review.internals?.streakBonus,
        answerQuality: persisted.review.internals?.answerQuality,
      },
    });
    state.nextIndex++;
    return {
      session: this.sessions.update(id, expectedRevision, state, persisted.review.reviewedAt),
      reviewed: entry,
      reviewedAt: persisted.review.reviewedAt,
    };
  }

  endStudySession(
    id: string,
    expectedRevision: number,
    outcome: "completed" | "quit",
    nowMs: number,
  ) {
    return this.history.transaction(() => {
      const session = this.sessions.findById(id);
      if (!session) throw new AppError("not_found", { message: "Study session not found" });
      if (session.endedAt || session.revision !== expectedRevision)
        throw new AppError("conflict", {
          message: "Study session changed since it was read",
          reason: "STUDY_REVISION_CONFLICT",
          details: { public: { currentRevision: session.revision } },
        });
      if (outcome === "completed" && session.state.nextIndex < session.state.sessionWords.length)
        throw new AppError("bad_request", { message: "Study session has unanswered terms" });
      const endedAt = new Date(nowMs).toISOString();
      const updated = this.sessions.update(id, expectedRevision, session.state, endedAt, endedAt);
      this.history.insert(
        historyRow(sessionHistoryDocument(session, endedAt, outcome), {
          sessionId: id,
          origin: "api",
          recordedAt: endedAt,
        }),
      );
      return updated;
    });
  }

  findStudySession(id: string) {
    return this.sessions.findById(id);
  }

  listStudyHistory(limit: number, after?: { startedAt: string; id: string }) {
    return this.history.list(limit, after);
  }

  findStudyHistory(id: string): StoredStudyHistory | null {
    return this.history.findById(id);
  }

  response(session: StoredStudySession) {
    const weak = new Set(session.state.weakEntryIds ?? []);
    return {
      id: session.id,
      revision: session.revision,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
      nextIndex: session.state.nextIndex,
      stats: session.state.stats,
      words: session.state.sessionWords,
      selection: session.state.selection,
      weakEntries: session.state.sessionWords
        .filter((word) => weak.has(word.id))
        .map(summarizeEntry),
    };
  }

  start(body: z.output<typeof routes.startStudy.body>) {
    return this.receipts.execute(body.mutationId, "study:start", body, () =>
      this.response(
        this.startStudySession({
          maxWords: body.maxWords,
          nowMs: Date.now(),
          startId: body.startId,
          endId: body.endId,
        }),
      ),
    );
  }

  answer(
    params: z.output<typeof routes.answerStudy.params>,
    body: z.output<typeof routes.answerStudy.body>,
  ) {
    validateHintLimit(body.hintCount, body.answerScore);
    return this.receipts.execute(body.mutationId, `study:answer:${params.id}`, body, () => {
      const result = this.answerStudySession(
        params.id,
        body.expectedRevision,
        body.entryId,
        body.answerScore,
        body.answerTimeMs,
        Date.now(),
        body.hintCount,
      );
      return {
        session: this.response(result.session),
        reviewed: summarizeEntry(result.reviewed),
        reviewedAt: result.reviewedAt,
      };
    });
  }

  end(
    params: z.output<typeof routes.endStudy.params>,
    body: z.output<typeof routes.endStudy.body>,
  ) {
    return this.receipts.execute(body.mutationId, `study:end:${params.id}`, body, () =>
      this.response(
        this.endStudySession(params.id, body.expectedRevision, body.outcome, Date.now()),
      ),
    );
  }
}
