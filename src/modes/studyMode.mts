import { ask, s, view } from "../ui/terminal.mjs";
import { VocabRepository, Vocab } from "../data/repository.mjs";
import {
  AnswerScore,
  DEFAULT_DIFFICULTY,
  DEFAULT_STRENGTH,
  getNewStateWithDefaults,
} from "../data/memory/memory.mjs";
import { sortByPriority } from "../data/memory/memory.priority.mjs";

export interface StudyStats {
  totalWords: number;
  wordsReviewed: number;
  veryKnowCount: number;
  knowCount: number;
  clueCount: number;
  cluesCount: number;
  noCount: number;
}

interface WordWithPriority extends Vocab {
  priority: number;
}

/**
 * Display the word and its forms (without clues)
 */
function displayWordForStudy(word: Vocab, index: number, total: number): void {
  view("\n" + "=".repeat(60));
  view(`Word ${index + 1} of ${total}`);
  view("=".repeat(60));
  view(`\n${s.aH(word.word.toUpperCase())}`);

  // Display forms if available
  if (word.forms && word.forms.length > 0) {
    view(`Forms: ${s.w(word.forms.join(", "))}`);
  }

  // Display word type info if available
  if (word.form && word.form.length > 0) {
    view(`Type: ${word.form.join(", ")}`);
  }

  if (word.types && word.types.length > 0) {
    view(`Categories: ${word.types.join(", ")}`);
  }

  if (word.irregular) {
    view(s.e("(irregular)"));
  }

  // const strengthDays = word.memoryStrength;
  // const difficulty = word.memoryDifficulty;
  // const streak = word.memoryStreak;
  // const lastReviewed = word.memoryLastReviewed;

  // view(`\nStrength: ${strengthDays.toFixed(2)} day(s)`);
  // view(`Difficulty: ${difficulty.toFixed(2)} (1-10)`);
  // view(`Streak: ${streak}`);
  // view(`Last reviewed: ${lastReviewed}`);
}

/**
 * Display first level clue (example)
 */
function displayExampleClue(word: Vocab): void {
  view(`\n${s.aH("💡 Clue - Example:")}`);
  if (word.example) {
    view(s.w(word.example));
  } else {
    view(s.e("No example available for this word."));
  }
}

/**
 * Display second level clue (related words and phrases)
 */
function displayRelatedClue(word: Vocab): void {
  view(`\n${s.aH("💡 Clue - Related & Phrases:")}`);

  if (word.related && word.related.length > 0) {
    view(s.w("Related: " + word.related.join(", ")));
  }

  if (word.phrases && word.phrases.length > 0) {
    view(s.w("Phrases:"));
    word.phrases.forEach((phrase) => view(`  • ${phrase}`));
  }

  if (
    (!word.related || word.related.length === 0) &&
    (!word.phrases || word.phrases.length === 0)
  ) {
    view(s.e("No related words or phrases available."));
  }
}

/**
 * Review a single word
 */
async function reviewWord(
  word: Vocab,
  index: number,
  total: number,
): Promise<{
  answerScore: AnswerScore;
  answerTime: number;
}> {
  let clueLevel = 0; // 0 = no clue, 1 = example, 2 = related
  const startedAt = Date.now();

  while (true) {
    console.clear();
    displayWordForStudy(word, index, total);

    if (clueLevel >= 1) {
      displayExampleClue(word);
    }

    if (clueLevel >= 2) {
      displayRelatedClue(word);
    }

    view(`\n${s.aH("Options:")}`);
    view("  o - Oh yaa! Perfectly");
    view("  k - I Know it");
    view("  n - No! I don't know it");
    if (clueLevel < 2) {
      view("  h - Hmm! Give me a clue");
    }
    view("  q - Quit study session");

    const response = await ask("\nYour choice: ");
    const choice = response.trim().toLowerCase();

    if (choice === "o") {
      if (clueLevel > 0) {
        view(s.w("\nYou already used a clue for this word."));
        await ask("Press Enter to continue...");
        continue;
      }
      return {
        answerScore: AnswerScore.VERY_KNOW,
        answerTime: Date.now() - startedAt,
      };
    } else if (choice === "k") {
      return {
        answerScore:
          clueLevel === 0
            ? AnswerScore.KNOW
            : clueLevel === 1
            ? AnswerScore.CLUE
            : AnswerScore.CLUES,
        answerTime: Date.now() - startedAt,
      };
    } else if (choice === "n") {
      // Show all info before moving on
      console.clear();
      displayWordForStudy(word, index, total);
      displayExampleClue(word);
      displayRelatedClue(word);
      view(`\n${s.e("Study this word carefully!")}`);
      await ask("\nPress Enter to continue...");
      return {
        answerScore: AnswerScore.NO,
        answerTime: Date.now() - startedAt,
      };
    } else if (choice === "h" && clueLevel < 2) {
      clueLevel++;
    } else if (choice === "q") {
      throw new Error("QUIT_SESSION");
    }
  }
}

/**
 * Display session statistics
 */
function displayStats(stats: StudyStats): void {
  view("\n" + "=".repeat(60));
  view(s.aH("Session Statistics"));
  view("=".repeat(60));
  view(`Total words in session: ${stats.totalWords}`);
  view(`Words reviewed: ${stats.wordsReviewed}`);
  view(`Perfect recall: ${s.aH(stats.veryKnowCount.toString())}`);
  view(`Knew it: ${s.aH(stats.knowCount.toString())}`);
  view(`With 1 clue: ${s.w(stats.clueCount.toString())}`);
  view(`With 2 clues: ${s.w(stats.cluesCount.toString())}`);
  view(`Didn't know: ${s.e(stats.noCount.toString())}`);

  if (stats.wordsReviewed > 0) {
    const correctCount =
      stats.veryKnowCount +
      stats.knowCount +
      stats.clueCount +
      stats.cluesCount;
    const accuracy = Math.round((correctCount / stats.wordsReviewed) * 100);
    view(`Accuracy: ${accuracy}%`);
  }
}

/**
 * Start a study session
 */
export async function startStudySession(
  repo: VocabRepository,
  maxWords: number = 20,
  startIndex?: number,
  endIndex?: number,
): Promise<void> {
  const allWords = repo.getAll();

  if (allWords.length === 0) {
    view(s.e("No words available to study. Add some words first!"));
    return;
  }

  // Select words based on range or max words (always study highest priority first)
  let sessionWords: WordWithPriority[];
  if (startIndex !== undefined) {
    // Range is 1-based and refers to the repository order (array index + 1)
    const start = Math.max(0, startIndex - 1);
    const endExclusive =
      endIndex !== undefined
        ? Math.min(allWords.length, endIndex)
        : allWords.length;

    const rangeWords = allWords.slice(start, endExclusive);
    sessionWords = sortByPriority(rangeWords);

    if (sessionWords.length === 0) {
      view(
        s.e(
          `Invalid range: words ${startIndex} to ${
            endIndex ?? allWords.length
          }. Total words available: ${allWords.length}`,
        ),
      );
      return;
    }
  } else {
    const sortedWords = sortByPriority(allWords);
    sessionWords = sortedWords.slice(0, Math.min(maxWords, sortedWords.length));
  }

  const stats: StudyStats = {
    totalWords: sessionWords.length,
    wordsReviewed: 0,
    veryKnowCount: 0,
    knowCount: 0,
    clueCount: 0,
    cluesCount: 0,
    noCount: 0,
  };

  view(s.aH("\n🎓 Starting Study Session"));
  view(`You will review ${sessionWords.length} words.\n`);
  await ask("Press Enter to begin...");

  try {
    for (let i = 0; i < sessionWords.length; i++) {
      const word = sessionWords[i];

      const { answerScore, answerTime } = await reviewWord(
        word,
        i,
        sessionWords.length,
      );

      // Update statistics
      stats.wordsReviewed++;
      if (answerScore === AnswerScore.VERY_KNOW) stats.veryKnowCount++;
      else if (answerScore === AnswerScore.KNOW) stats.knowCount++;
      else if (answerScore === AnswerScore.CLUE) stats.clueCount++;
      else if (answerScore === AnswerScore.CLUES) stats.cluesCount++;
      else if (answerScore === AnswerScore.NO) stats.noCount++;

      // Update word in repository
      const now = Date.now();
      const lastReviewedMs = new Date(word.memoryLastReviewed).getTime();
      const msSinceLastReview = Math.max(0, now - lastReviewedMs);

      const { newStrength, newDifficulty, newStreak } = getNewStateWithDefaults(
        {
          answerScore,
          answerTime,
          itemLength: Math.max(1, word.word.length),
          strength: word.memoryStrength ?? 0,
          msSinceLastReview,
          difficulty: word.memoryDifficulty ?? 0,
          streak: word.memoryStreak ?? 0,
        },
      );

      repo.update(word.word, {
        memoryStrength: newStrength,
        memoryDifficulty: newDifficulty,
        memoryStreak: newStreak,
        memoryLastReviewed: new Date(now).toISOString(),
      });
    }

    console.clear();
    view(s.aH("\n✓ Study session completed!"));
    displayStats(stats);
  } catch (error) {
    if (error instanceof Error && error.message === "QUIT_SESSION") {
      console.clear();
      view(s.w("\nStudy session ended early."));
      if (stats.wordsReviewed > 0) {
        displayStats(stats);
      }
    } else {
      throw error;
    }
  }
}

/**
 * Configure study session parameters
 */
export async function configureStudySession(
  repo: VocabRepository,
): Promise<void> {
  view(s.aH("\n📚 Study Session Configuration"));

  const totalWords = repo.count();
  view(`Total words available: ${totalWords}\n`);

  view("Study by:");
  view("  1 - Number of words (from highest priority)");
  view("  2 - Specific word range (by position number)");

  const modeChoice = await ask("\nYour choice (default: 1): ");
  const mode = modeChoice.trim() || "1";

  if (mode === "2") {
    // Range-based selection
    const startStr = await ask("Start position (1-based, e.g., 5): ");
    const startIndex = parseInt(startStr.trim(), 10);

    if (isNaN(startIndex) || startIndex <= 0 || startIndex > totalWords) {
      view(s.e("Invalid start position. Cancelled."));
      return;
    }

    const endStr = await ask(`End position (default: ${totalWords}): `);
    const endIndex = endStr.trim() ? parseInt(endStr.trim(), 10) : undefined;

    if (
      endIndex !== undefined &&
      (isNaN(endIndex) || endIndex < startIndex || endIndex > totalWords)
    ) {
      view(s.e("Invalid end position. Cancelled."));
      return;
    }

    await startStudySession(repo, 20, startIndex, endIndex);
  } else {
    // Max words selection (default)
    const maxWordsStr = await ask(
      "How many words do you want to study? (default: 20): ",
    );
    const maxWords = maxWordsStr.trim() ? parseInt(maxWordsStr.trim(), 10) : 20;

    if (isNaN(maxWords) || maxWords <= 0) {
      view(s.e("Invalid number. Using default: 20"));
      await startStudySession(repo, 20);
    } else {
      await startStudySession(repo, maxWords);
    }
  }
}
