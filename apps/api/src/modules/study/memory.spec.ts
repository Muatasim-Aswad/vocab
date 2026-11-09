import { describe, expect, it } from "vite-plus/test";

import type { VocabEntry } from "../vocabulary/vocab.types.js";
import {
  AnswerScore,
  DEFAULT_DIFFICULTY,
  DEFAULT_STRENGTH,
  getForgetProbability,
  getNewStateWithDefaults,
  MINIMAL_REVIEW_INTERVAL_DAYS,
  MS_IN_DAY,
} from "./memory.js";
import { calculatePriorityValue, sortByPriority } from "./priority.js";
import { persistStudyReview, prepareStudySession } from "./study-session-engine.js";

const strong = () =>
  getNewStateWithDefaults({
    answerScore: AnswerScore.VERY_KNOW,
    answerTime: 700,
    itemLength: 6,
    strength: 3,
    msSinceLastReview: 3 * MS_IN_DAY,
    difficulty: 2,
    streak: 1,
  });
const forgotten = () =>
  getNewStateWithDefaults({
    answerScore: AnswerScore.NO,
    answerTime: 5000,
    itemLength: 9,
    strength: 5,
    msSinceLastReview: 3 * MS_IN_DAY,
    difficulty: 2,
    streak: 2,
  });
const immediate = () =>
  getNewStateWithDefaults({
    answerScore: AnswerScore.NO,
    answerTime: 4000,
    itemLength: 7,
    strength: 6,
    msSinceLastReview: 0.05 * MS_IN_DAY,
    difficulty: 3,
    streak: 4,
  });

describe("legacy study memory golden calculations", () => {
  it("compatibility: memory:forget uses the legacy exponential forgetting equation", () => {
    expect(
      getForgetProbability({ strength: 3, difficulty: 2, daysSinceLastReview: 1 }),
    ).toBeCloseTo(1 - Math.exp(-2 / 3), 14);
  });

  it("compatibility: memory:speed rewards a fast correct answer but no speed on a wrong one", () => {
    let fastSpeed = -1;
    getNewStateWithDefaults(
      {
        answerScore: 1,
        answerTime: 700,
        itemLength: 6,
        strength: 3,
        msSinceLastReview: MS_IN_DAY,
        difficulty: 2,
        streak: 0,
      },
      (internals) => {
        fastSpeed = internals.speedScore;
      },
    );
    let wrongSpeed = -1;
    getNewStateWithDefaults(
      {
        answerScore: 0,
        answerTime: 700,
        itemLength: 6,
        strength: 3,
        msSinceLastReview: MS_IN_DAY,
        difficulty: 2,
        streak: 0,
      },
      (internals) => {
        wrongSpeed = internals.speedScore;
      },
    );
    expect(fastSpeed).toBeGreaterThan(0);
    expect(fastSpeed).toBeLessThanOrEqual(1);
    expect(wrongSpeed).toBe(0);
  });

  it("compatibility: memory:quality combines score, speed and streak to match the oracle", () => {
    expect(strong()).toEqual({
      newStrength: 5.699119403345657,
      newDifficulty: 1.920058706443623,
      newStreak: 2,
    });
  });

  it("compatibility: memory:strength applies the legacy wrong-answer penalty and floor", () => {
    expect(forgotten()).toEqual({ newStrength: 1.5, newDifficulty: 2.1, newStreak: 0 });
    expect(
      getNewStateWithDefaults({
        answerScore: 0,
        answerTime: 5000,
        itemLength: 3,
        strength: 1,
        msSinceLastReview: 3 * MS_IN_DAY,
        difficulty: 2,
        streak: 0,
      }).newStrength,
    ).toBe(1);
  });

  it("compatibility: memory:difficulty clamps correction to the historical range", () => {
    expect(
      getNewStateWithDefaults({
        answerScore: 0,
        answerTime: 1000,
        itemLength: 2,
        strength: 2,
        msSinceLastReview: MS_IN_DAY,
        difficulty: 10,
        streak: 0,
      }).newDifficulty,
    ).toBe(10);
    expect(
      getNewStateWithDefaults({
        answerScore: 1.5,
        answerTime: 1000,
        itemLength: 2,
        strength: 2,
        msSinceLastReview: MS_IN_DAY,
        difficulty: 1,
        streak: 0,
      }).newDifficulty,
    ).toBe(1);
  });

  it("compatibility: memory:short keeps learned state stable on immediate review", () => {
    expect(MINIMAL_REVIEW_INTERVAL_DAYS).toBe(0.11);
    expect(immediate()).toEqual({ newStrength: 6, newDifficulty: 3, newStreak: 4 });
  });

  it("compatibility: memory:defaults coerces invalid state before review", () => {
    const actual = getNewStateWithDefaults({
      answerScore: 1,
      answerTime: 1000,
      itemLength: 4,
      strength: 0,
      msSinceLastReview: MS_IN_DAY,
      difficulty: 0,
      streak: 0,
    });
    const expected = getNewStateWithDefaults({
      answerScore: 1,
      answerTime: 1000,
      itemLength: 4,
      strength: DEFAULT_STRENGTH,
      msSinceLastReview: MS_IN_DAY,
      difficulty: DEFAULT_DIFFICULTY,
      streak: 0,
    });
    expect(actual).toEqual(expected);
  });

  it("compatibility: memory:score preserves all five legacy answer values", () => {
    expect([
      AnswerScore.VERY_KNOW,
      AnswerScore.KNOW,
      AnswerScore.CLUE,
      AnswerScore.CLUES,
      AnswerScore.NO,
    ]).toEqual([1.5, 1, 0.5, 0.2, 0]);
  });

  it("compatibility: study:priority matches fixed-clock oracle and immediate penalty", () => {
    const nowMs = Date.parse("2024-04-05T12:00:00.000Z");
    const rows = sortByPriority(
      [
        { id: 2, memory: { strength: 3, difficulty: 2, lastReviewed: "2024-04-05T11:00:00.000Z" } },
        { id: 1, memory: { strength: 3, difficulty: 2, lastReviewed: "2024-04-04T12:00:00.000Z" } },
      ],
      { nowMs: () => nowMs },
    );
    expect(rows.map(({ id, priority }) => ({ id, priority }))).toEqual([
      { id: 1, priority: 0.486582880967408 },
      { id: 2, priority: -0.9726044771163483 },
    ]);
    expect(calculatePriorityValue(rows[0]!.memory, nowMs)).toBe(rows[0]!.priority);
  });

  it("compatibility: study:selection chooses top priority or an ID range and rejects an empty store", () => {
    const nowMs = Date.parse("2024-04-05T12:00:00.000Z");
    const entries: VocabEntry[] = [1, 2].map((id) => ({
      id,
      lemma: `term${id}`,
      language: "nl",
      status: "active",
      memory: {
        strength: 3,
        difficulty: 2,
        streak: 0,
        lastReviewed: id === 1 ? "2024-04-04T12:00:00.000Z" : "2024-04-05T11:00:00.000Z",
      },
      meta: { addedAt: "", modifiedAt: "" },
    }));
    const source = {
      getActiveInventory: () => ({ totalWords: 2, minId: 1, maxId: 2 }),
      streamActivePrioritySeeds: () => entries.map(({ id, memory }) => ({ id, memory })),
      findActiveByIds: (ids: number[]) =>
        ids.map((id) => entries.find((entry) => entry.id === id)!),
      findActiveInRange: (startId: number, endId: number) =>
        entries.filter((entry) => entry.id >= startId && entry.id <= endId),
    };
    expect(
      prepareStudySession(source, { maxWords: 1, nowMs }).sessionWords.map((entry) => entry.id),
    ).toEqual([1]);
    expect(
      prepareStudySession(source, { maxWords: 1, nowMs, startId: 2, endId: 2 }).selection,
    ).toEqual({ type: "range", startId: 2, endId: 2 });
    expect(() =>
      prepareStudySession(
        { ...source, getActiveInventory: () => ({ totalWords: 0, minId: 0, maxId: 0 }) },
        { maxWords: 1, nowMs },
      ),
    ).toThrow();
  });

  it("compatibility: study:review persists computed memory only after a scored review", () => {
    const calls: { id: number; memory: unknown; expectedRevision: number | undefined }[] = [];
    const nowMs = Date.parse("2024-04-05T12:00:00.000Z");
    const entry = {
      id: 1,
      lemma: "bank",
      language: "nl",
      priority: 0.5,
      memory: { strength: 3, difficulty: 2, streak: 0, lastReviewed: "2024-04-04T12:00:00.000Z" },
      meta: { addedAt: "", modifiedAt: "" },
    };
    const result = persistStudyReview(
      {
        saveReview: (id, memory, expectedRevision) => {
          calls.push({ id, memory, expectedRevision });
          return "saved";
        },
      },
      { entry, answerScore: AnswerScore.KNOW, answerTime: 700, nowMs },
    );
    expect(calls).toHaveLength(1);
    expect(result.review).toMatchObject({
      id: 1,
      term: "bank",
      reviewedAt: "2024-04-05T12:00:00.000Z",
    });
    expect(result.memory).toEqual(calls[0]!.memory);
    expect(() =>
      persistStudyReview(
        { saveReview: () => "missing" },
        { entry, answerScore: AnswerScore.KNOW, answerTime: 700, nowMs },
      ),
    ).toThrow("Persisting study data failed.");
    expect(() =>
      persistStudyReview(
        { saveReview: () => "stale" },
        { entry, answerScore: AnswerScore.KNOW, answerTime: 700, nowMs },
      ),
    ).toThrow("Entry changed since it was read.");
  });
});
