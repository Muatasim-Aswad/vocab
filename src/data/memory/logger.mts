import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryInternals } from "./memory.mjs";

export type StudySessionSelection =
  | {
      type: "top";
      maxWords: number;
    }
  | {
      type: "range";
      startIndex: number;
      endIndex?: number;
    };

export type StudySessionSortRow = {
  word: string;
  priority: number;
};

export type StudySessionReviewRow = {
  word: string;
  priority: number;
  reviewedAt: string;
  before: {
    strength: number;
    difficulty: number;
    streak: number;
    lastReviewed: string;
  };
  after: {
    strength: number;
    difficulty: number;
    streak: number;
  };
  internals?: StudySessionStoredInternals;
};

export type StudySessionReviewInput = {
  word: string;
  priority: number;
  reviewedAt: string;
  beforeLastReviewed?: string;
  answerScore?: number;
  answerTime?: number;
  before?: {
    strength: number;
    difficulty: number;
    streak: number;
  };
  after?: {
    strength: number;
    difficulty: number;
    streak: number;
  };
  internals?: MemoryInternals;
};

export type StudySessionStoredInternals = {
  currentForgetProbability?: number;
  expectedAnswerTime?: number;
  answerTime: number;
  answerScore: number;
  speedScore?: number;
  streakBonus?: number;
  answerQuality?: number;
};

export type StudySessionOutcome =
  | { status: "completed" }
  | { status: "quit" }
  | { status: "error"; message: string };

export type StudySessionStats = {
  totalWords: number;
  wordsReviewed: number;
  veryKnowCount: number;
  knowCount: number;
  clueCount: number;
  cluesCount: number;
  noCount: number;
};

export type StudySessionLog = {
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  selection: StudySessionSelection;
  sortResult?: StudySessionSortRow[];
  reviews: StudySessionReviewRow[];
  stats?: StudySessionStats;
  outcome?: StudySessionOutcome;
};

type LoggerConfig = {
  selection: StudySessionSelection;
  startedAtMs?: number;
};

export type StudySessionLogger = {
  readonly sessionId: string;
  recordSortResult: (rows: StudySessionSortRow[]) => void;
  recordReview: (input: StudySessionReviewInput) => void;
  finalize: (params: {
    stats: StudySessionStats;
    outcome: StudySessionOutcome;
    endedAtMs?: number;
  }) => Promise<{ path: string; log: StudySessionLog }>;
};

const nowIso = (ms: number) => new Date(ms).toISOString();

const createSessionId = () => {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rand}`;
};

const findProjectRoot = (startDir: string) => {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

const getLogsDir = () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const projectRoot = findProjectRoot(__dirname) ?? process.cwd();
  return join(projectRoot, "src", "data", "memory", "logs");
};

const safeFilenamePart = (s: string) =>
  s.replaceAll(":", "-").replaceAll(".", "-");

const createLogPath = (
  logsDir: string,
  sessionId: string,
  startedAtMs: number,
) => {
  const stamp = safeFilenamePart(nowIso(startedAtMs));
  return join(logsDir, `study-session-${stamp}-${sessionId}.json`);
};

const requireNumber = (value: number | undefined, label: string) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`Missing or invalid ${label} for study session log`);
};

const toStoredInternals = (params: {
  internals: MemoryInternals | undefined;
  answerTime: number;
  answerScore: number;
}): StudySessionStoredInternals => {
  const { internals, answerTime, answerScore } = params;
  return {
    currentForgetProbability: internals?.currentForgetProbability,
    expectedAnswerTime: internals?.expectedAnswerTime,
    answerTime,
    answerScore,
    speedScore: internals?.speedScore,
    streakBonus: internals?.streakBonus,
    answerQuality: internals?.answerQuality,
  };
};

const buildReviewRow = (
  input: StudySessionReviewInput,
): StudySessionReviewRow => {
  const internals = input.internals;
  const reviewedAtMs = Date.parse(input.reviewedAt);
  const MS_IN_DAY = 24 * 60 * 60 * 1000;
  const derivedBeforeLastReviewed =
    Number.isFinite(reviewedAtMs) &&
    typeof internals?.daysSinceLastReview === "number"
      ? new Date(
          reviewedAtMs - Math.round(internals.daysSinceLastReview * MS_IN_DAY),
        ).toISOString()
      : undefined;
  const beforeLastReviewed =
    derivedBeforeLastReviewed ?? input.beforeLastReviewed;
  if (!beforeLastReviewed) {
    throw new Error(
      "Missing beforeLastReviewed (provide it or pass internals.daysSinceLastReview + reviewedAt)",
    );
  }

  const answerScore =
    internals?.answerScore ?? requireNumber(input.answerScore, "answerScore");
  const answerTime =
    internals?.answerTime ?? requireNumber(input.answerTime, "answerTime");

  const beforeStrength =
    internals?.currentStrength ??
    requireNumber(input.before?.strength, "before.strength");
  const beforeDifficulty =
    internals?.currentDifficulty ??
    requireNumber(input.before?.difficulty, "before.difficulty");
  const beforeStreak =
    internals?.currentStreak ??
    requireNumber(input.before?.streak, "before.streak");

  const afterStrength =
    internals?.newStrength ??
    requireNumber(input.after?.strength, "after.strength");
  const afterDifficulty =
    internals?.newDifficulty ??
    requireNumber(input.after?.difficulty, "after.difficulty");
  const afterStreak =
    internals?.newStreak ?? requireNumber(input.after?.streak, "after.streak");

  return {
    word: input.word,
    priority: input.priority,
    reviewedAt: input.reviewedAt,
    before: {
      strength: beforeStrength,
      difficulty: beforeDifficulty,
      streak: beforeStreak,
      lastReviewed: beforeLastReviewed,
    },
    after: {
      strength: afterStrength,
      difficulty: afterDifficulty,
      streak: afterStreak,
    },
    internals: toStoredInternals({ internals, answerTime, answerScore }),
  };
};

export function createStudySessionLogger(
  config: LoggerConfig,
): StudySessionLogger {
  const startedAtMs = config.startedAtMs ?? Date.now();
  const sessionId = createSessionId();

  const log: StudySessionLog = {
    schemaVersion: 1,
    sessionId,
    startedAt: nowIso(startedAtMs),
    selection: config.selection,
    reviews: [],
  };

  return {
    sessionId,
    recordSortResult(rows) {
      log.sortResult = rows;
    },
    recordReview(input) {
      log.reviews.push(buildReviewRow(input));
    },
    async finalize(params) {
      const endedAtMs = params.endedAtMs ?? Date.now();
      log.endedAt = nowIso(endedAtMs);
      log.stats = params.stats;
      log.outcome = params.outcome;

      const logsDir = getLogsDir();
      await mkdir(logsDir, { recursive: true });

      const path = createLogPath(logsDir, sessionId, startedAtMs);
      await writeFile(path, JSON.stringify(log, null, 2) + "\n", "utf8");
      return { path, log };
    },
  };
}
