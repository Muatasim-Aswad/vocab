import type { DisplayContext, Entry, StudySession } from "../../infra/api.ts";
import type { AppContext } from "../../platform/context.ts";
import { s } from "../../platform/terminal.ts";
import { formatDisplayTerm } from "../../shared/display-term.ts";
import { displayWord, isIrregular, relationGroups } from "../vocabulary/render.ts";
import { studyCopy } from "./copy.ts";

type Word = StudySession["words"][number];
type Stats = StudySession["stats"];

const Score = { VERY_KNOW: 1.5, KNOW: 1, CLUE: 0.5, CLUES: 0.2, NO: 0 } as const;
type AnswerScore = (typeof Score)[keyof typeof Score];

/** The contract caps a single answer time at ten minutes. */
const maxAnswerTimeMs = 600_000;

class StudyQuit extends Error {
  override readonly name = "StudyQuit";
}

const emptyStats = (totalWords: number): Stats => ({
  totalWords,
  wordsReviewed: 0,
  veryKnowCount: 0,
  knowCount: 0,
  clueCount: 0,
  cluesCount: 0,
  noCount: 0,
});

/** Consolidation rounds are local practice, counted without memory updates. */
function countAnswer(stats: Stats, score: AnswerScore): void {
  stats.wordsReviewed++;
  if (score === Score.VERY_KNOW) stats.veryKnowCount++;
  else if (score === Score.KNOW) stats.knowCount++;
  else if (score === Score.CLUE) stats.clueCount++;
  else if (score === Score.CLUES) stats.cluesCount++;
  else stats.noCount++;
}

const isStrong = (score: AnswerScore) => score === Score.VERY_KNOW || score === Score.KNOW;

function displayStats(ctx: AppContext, stats: Stats): void {
  const { view } = ctx.io;
  view("\n" + "=".repeat(60));
  view(s.aH(studyCopy.statsHeading));
  view("=".repeat(60));
  view(studyCopy.total(stats.totalWords));
  view(studyCopy.reviewed(stats.wordsReviewed));
  view(studyCopy.perfect(s.aH(stats.veryKnowCount.toString())));
  view(studyCopy.knew(s.aH(stats.knowCount.toString())));
  view(studyCopy.oneClue(s.w(stats.clueCount.toString())));
  view(studyCopy.twoClues(s.w(stats.cluesCount.toString())));
  view(studyCopy.unknown(s.e(stats.noCount.toString())));
  if (stats.wordsReviewed > 0) {
    const correct = stats.veryKnowCount + stats.knowCount + stats.clueCount + stats.cluesCount;
    view(studyCopy.accuracy(Math.round((correct / stats.wordsReviewed) * 100)));
  }
}

const unresolved: DisplayContext = { resolve: () => null, siblingsOf: () => [] };

/** Relation targets and sibling meanings, fetched ahead of the prompts that need them. */
class ContextCache {
  private readonly loaded = new Map<number, Promise<DisplayContext>>();
  constructor(private readonly ctx: AppContext) {}

  prefetch(entry: Entry | undefined): void {
    if (entry && !this.loaded.has(entry.id))
      this.loaded.set(
        entry.id,
        this.ctx.api.displayContext([entry], { siblings: true }).catch(() => unresolved),
      );
  }

  get(entry: Entry): Promise<DisplayContext> {
    this.prefetch(entry);
    return this.loaded.get(entry.id)!;
  }
}

function showStudyWord(ctx: AppContext, entry: Entry, index: number, total: number): void {
  const { view } = ctx.io;
  const term = formatDisplayTerm(entry);
  view("\n" + "=".repeat(60));
  view(studyCopy.termWithId(index + 1, total, entry.id));
  view("=".repeat(60));
  view(`\n${s.w(entry.senseCue ? studyCopy.termWithCue(term, entry.senseCue) : term)}`);
  if (entry.forms && entry.forms.length > 0) view(entry.forms.join(", "));
  const info = [
    ...(entry.partOfSpeech ? [entry.partOfSpeech] : []),
    ...(entry.tags ?? []),
    ...(isIrregular(entry) ? [studyCopy.irregular] : []),
  ];
  if (info.length > 0) view(info.join(", "));
}

function showExampleClue(ctx: AppContext, entry: Entry): void {
  const example = entry.examples?.[0];
  ctx.io.view(studyCopy.clue(s.aH("💡 "), example ? s.e(example) : s.a(studyCopy.noExample)));
}

function showRelatedClue(ctx: AppContext, entry: Entry, context: DisplayContext): void {
  const { view } = ctx.io;
  view(
    `\n${s.aH("💡 ")} ${
      entry.collocations && entry.collocations.length > 0
        ? s.r(entry.collocations.join(", "))
        : s.a(studyCopy.noCombinations)
    }`,
  );
  const groups = relationGroups(entry, context.resolve);
  view(
    `\n${s.a("💡 ")} ${
      entry.relations && entry.relations.length > 0
        ? s.a(groups.map(([label, targets]) => `${label}: ${targets.join(", ")}`).join(" | "))
        : s.a(studyCopy.noRelated)
    }`,
  );
}

async function showCompleteWord(
  ctx: AppContext,
  cache: ContextCache,
  entry: Entry,
  index: number,
  total: number,
  score: AnswerScore,
  note?: string,
): Promise<boolean> {
  const context = await cache.get(entry);
  ctx.io.clearScreen();
  ctx.io.view("\n" + "=".repeat(60));
  ctx.io.view(studyCopy.term(index + 1, total));
  ctx.io.view("=".repeat(60));
  displayWord(ctx.io.view, entry, entry.id, {
    showDates: false,
    showExtra: score === Score.NO,
    resolveEntryById: context.resolve,
    siblings: context.siblingsOf(entry),
  });
  if (note) ctx.io.view(s.alert("\n" + note));
  const alreadyNo = score === Score.NO;
  const response = await ctx.io.ask(alreadyNo ? studyCopy.continue : studyCopy.continueOrChange);
  return !alreadyNo && response.trim().toLowerCase() === "n";
}

async function reviewWord(
  ctx: AppContext,
  cache: ContextCache,
  entry: Entry,
  index: number,
  total: number,
): Promise<{ score: AnswerScore; timeMs: number; hints: number }> {
  let clueLevel = 0;
  const startedAt = ctx.now();
  const elapsed = () => Math.min(maxAnswerTimeMs, Math.max(0, ctx.now() - startedAt));
  while (true) {
    ctx.io.clearScreen();
    showStudyWord(ctx, entry, index, total);
    if (clueLevel >= 1) showExampleClue(ctx, entry);
    if (clueLevel >= 2) showRelatedClue(ctx, entry, await cache.get(entry));
    ctx.io.view(`\n${s.aH(studyCopy.options)}`);
    ctx.io.view(studyCopy.perfectOption);
    ctx.io.view(studyCopy.knowOption);
    ctx.io.view(studyCopy.unknownOption);
    if (clueLevel < 2) ctx.io.view(studyCopy.clueOption);
    const choice = (await ctx.io.ask(studyCopy.choice)).trim().toLowerCase();
    if (choice === "o") {
      if (clueLevel > 0) {
        ctx.io.view(s.w(studyCopy.clueAlreadyUsed));
        await ctx.io.ask(studyCopy.continueAfterClue);
        continue;
      }
      const timeMs = elapsed();
      const changed = await showCompleteWord(ctx, cache, entry, index, total, Score.VERY_KNOW);
      return { score: changed ? Score.NO : Score.VERY_KNOW, timeMs, hints: clueLevel };
    }
    if (choice === "k") {
      const timeMs = elapsed();
      const initial = clueLevel === 0 ? Score.KNOW : clueLevel === 1 ? Score.CLUE : Score.CLUES;
      const changed = await showCompleteWord(ctx, cache, entry, index, total, initial);
      return { score: changed ? Score.NO : initial, timeMs, hints: clueLevel };
    }
    if (choice === "n") {
      await showCompleteWord(
        ctx,
        cache,
        entry,
        index,
        total,
        Score.NO,
        `   ${formatDisplayTerm(entry)}`.repeat(3),
      );
      return { score: Score.NO, timeMs: elapsed(), hints: clueLevel };
    }
    if (choice === "h" && clueLevel < 2) clueLevel++;
    else if (choice === "q") throw new StudyQuit();
  }
}

/** Reviews `words` in order; `onAnswer` records the answer (server memory update or local count). */
async function runRound(
  ctx: AppContext,
  words: Word[],
  onAnswer: (
    word: Word,
    answer: { score: AnswerScore; timeMs: number; hints: number },
  ) => Promise<void>,
): Promise<void> {
  const cache = new ContextCache(ctx);
  for (const [index, word] of words.entries()) {
    cache.prefetch(words[index + 1]);
    await onAnswer(word, await reviewWord(ctx, cache, word, index, words.length));
  }
}

async function runConsolidation(ctx: AppContext, words: Word[]): Promise<void> {
  const { io } = ctx;
  let consolidation = words;
  for (let round = 1; consolidation.length > 0; round++) {
    const response = (await io.ask(studyCopy.consolidate(consolidation.length)))
      .trim()
      .toLowerCase();
    if (response !== "" && response !== "y" && response !== "yes") break;
    io.view(s.aH(studyCopy.startingConsolidation(round)));
    io.view(studyCopy.weakCount(consolidation.length));
    await io.ask(studyCopy.begin);
    const stats = emptyStats(consolidation.length);
    const nextWeak: Word[] = [];
    try {
      await runRound(ctx, consolidation, async (word, answer) => {
        countAnswer(stats, answer.score);
        if (!isStrong(answer.score)) nextWeak.push(word);
      });
    } catch (error) {
      if (!(error instanceof StudyQuit)) throw error;
      io.clearScreen();
      io.view(s.w(studyCopy.consolidationEnded));
      if (stats.wordsReviewed > 0) displayStats(ctx, stats);
      break;
    }
    io.clearScreen();
    io.view(s.aH(studyCopy.consolidationCompleted(round)));
    displayStats(ctx, stats);
    consolidation = nextWeak;
  }
}

async function startStudySession(
  ctx: AppContext,
  maxWords: number,
  startId?: number,
  endId?: number,
): Promise<void> {
  const { io, api } = ctx;
  let session = await api.startStudy({
    maxWords,
    ...(startId !== undefined && { startId }),
    ...(endId !== undefined && { endId }),
  });
  io.view(s.aH(studyCopy.starting));
  io.view(studyCopy.reviewCount(session.words.length));
  await io.ask(studyCopy.begin);

  let outcome: "completed" | "quit" | "error" = "completed";
  try {
    await runRound(ctx, session.words, async (word, answer) => {
      const result = await api.answerStudy(session.id, {
        expectedRevision: session.revision,
        entryId: word.id,
        answerScore: answer.score,
        answerTimeMs: answer.timeMs,
        hintCount: answer.hints,
      });
      session = result.session;
    });
    io.clearScreen();
    io.view(s.aH(studyCopy.completed));
    displayStats(ctx, session.stats);

    const weakIds = new Set(session.weakEntries.map((entry) => entry.id));
    const weakWords = session.words.filter((word) => weakIds.has(word.id));
    await runConsolidation(ctx, weakWords);
  } catch (error) {
    if (!(error instanceof StudyQuit)) {
      outcome = "error";
      throw error;
    }
    outcome = "quit";
    io.clearScreen();
    io.view(s.w(studyCopy.sessionEnded));
    if (session.stats.wordsReviewed > 0) displayStats(ctx, session.stats);
  } finally {
    // Ending stores the final history record in the API database; a failed answer leaves it open.
    if (outcome !== "error") await endSession(ctx, session, outcome);
  }
}

async function endSession(
  ctx: AppContext,
  session: StudySession,
  outcome: "completed" | "quit",
): Promise<void> {
  try {
    await ctx.api.endStudy(session.id, session.revision, outcome);
  } catch (error) {
    if (ctx.studyLogPolicy === "fail-fast") throw error;
    const message = error instanceof Error ? error.message : studyCopy.unknownLoggingError;
    ctx.io.view(s.w(studyCopy.loggingFailed(message)));
  }
}

export async function configureStudySession(ctx: AppContext): Promise<void> {
  const { io } = ctx;
  io.view(s.aH(studyCopy.configuration));
  const { totalWords, minId, maxId } = await ctx.api.studyInventory();
  io.view(studyCopy.inventory(totalWords, minId, maxId));
  io.view(studyCopy.studyBy);
  io.view(studyCopy.countMode);
  io.view(studyCopy.rangeMode);
  const modeChoice = await io.ask(studyCopy.modeChoice);
  if (modeChoice.includes("q")) {
    io.clearScreen();
    io.view(s.e(studyCopy.cancelled));
    return;
  }
  if ((modeChoice.trim() || "1") === "2") {
    const startId = Number.parseInt((await io.ask(studyCopy.startId(minId))).trim(), 10);
    if (Number.isNaN(startId) || startId < minId || startId > maxId) {
      io.clearScreen();
      io.view(s.e(studyCopy.invalidStart));
      return;
    }
    const endText = (await io.ask(studyCopy.endId(maxId))).trim();
    const endId = endText ? Number.parseInt(endText, 10) : undefined;
    if (endId !== undefined && (Number.isNaN(endId) || endId < startId || endId > maxId)) {
      io.clearScreen();
      io.view(s.e(studyCopy.invalidEnd));
      return;
    }
    return startStudySession(ctx, 20, startId, endId);
  }
  const countText = (await io.ask(studyCopy.countPrompt)).trim();
  const maxWords = countText ? Number.parseInt(countText, 10) : 20;
  if (Number.isNaN(maxWords) || maxWords <= 0) {
    io.view(s.e(studyCopy.invalidCount));
    return startStudySession(ctx, 20);
  }
  await startStudySession(ctx, maxWords);
}
