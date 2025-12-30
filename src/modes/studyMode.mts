import { ask, s, view } from "../ui/terminal.mjs";
import { VocabRepository, Vocab } from "../data/repository.mjs";
import {
  AnswerScore,
  DEFAULT_DIFFICULTY,
  DEFAULT_STRENGTH,
  getNewStateWithDefaults,
} from "../data/memory/memory.mjs";
import { sortByPriority } from "../data/memory/memory.priority.mjs";

enum RecallScore {
  DONT_KNOW = 0,
  CLUE_USED = 1,
  KNOW = 2,
}

export interface StudyStats {
  totalWords: number;
  wordsReviewed: number;
  knowCount: number;
  dontKnowCount: number;
  clueCount: number;
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

  const strengthDays = word.memoryStrength ?? DEFAULT_STRENGTH;
  const difficulty = word.memoryDifficulty ?? DEFAULT_DIFFICULTY;
  const streak = word.memoryStreak ?? 0;
  const lastReviewed = word.memoryLastReviewed ?? "(never)";

  view(`\nStrength: ${strengthDays.toFixed(2)} day(s)`);
  view(`Difficulty: ${difficulty.toFixed(2)} (1-10)`);
  view(`Streak: ${streak}`);
  view(`Last reviewed: ${lastReviewed}`);
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
  recallScore: RecallScore;
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
    view("  k - I know it");
    view("  d - I don't know it");
    if (clueLevel < 2) {
      view("  c - Give me a clue");
    }
    view("  q - Quit study session");

    const response = await ask("\nYour choice: ");
    const choice = response.trim().toLowerCase();

    if (choice === "k") {
      return {
        recallScore: clueLevel > 0 ? RecallScore.CLUE_USED : RecallScore.KNOW,
        answerScore:
          clueLevel === 0
            ? AnswerScore.KNOW
            : clueLevel === 1
            ? AnswerScore.CLUE
            : AnswerScore.CLUES,
        answerTime: Date.now() - startedAt,
      };
    } else if (choice === "d") {
      // Show all info before moving on
      console.clear();
      displayWordForStudy(word, index, total);
      displayExampleClue(word);
      displayRelatedClue(word);
      view(`\n${s.e("Study this word carefully!")}`);
      await ask("\nPress Enter to continue...");
      return {
        recallScore: RecallScore.DONT_KNOW,
        answerScore: AnswerScore.NO,
        answerTime: Date.now() - startedAt,
      };
    } else if (choice === "c" && clueLevel < 2) {
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
  view(`Known immediately: ${s.aH(stats.knowCount.toString())}`);
  view(`Needed clues: ${s.w(stats.clueCount.toString())}`);
  view(`Didn't know: ${s.e(stats.dontKnowCount.toString())}`);

  if (stats.wordsReviewed > 0) {
    const accuracy = Math.round((stats.knowCount / stats.wordsReviewed) * 100);
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

  // Sort by priority
  const sortedWords = sortByPriority(allWords);

  // Select words based on range or max words
  let sessionWords: WordWithPriority[];
  if (startIndex !== undefined) {
    const start = Math.max(0, startIndex - 1); // Convert to 0-based index
    const end = endIndex !== undefined ? endIndex : sortedWords.length; // Default to last word
    sessionWords = sortedWords.slice(start, end);

    if (sessionWords.length === 0) {
      view(
        s.e(
          `Invalid range: words ${startIndex} to ${end}. Total words available: ${sortedWords.length}`,
        ),
      );
      return;
    }
  } else {
    sessionWords = sortedWords.slice(0, Math.min(maxWords, sortedWords.length));
  }

  const stats: StudyStats = {
    totalWords: sessionWords.length,
    wordsReviewed: 0,
    knowCount: 0,
    dontKnowCount: 0,
    clueCount: 0,
  };

  view(s.aH("\n🎓 Starting Study Session"));
  view(`You will review ${sessionWords.length} words.\n`);
  await ask("Press Enter to begin...");

  try {
    for (let i = 0; i < sessionWords.length; i++) {
      const word = sessionWords[i];

      const { recallScore, answerScore, answerTime } = await reviewWord(
        word,
        i,
        sessionWords.length,
      );

      // Update statistics
      stats.wordsReviewed++;
      if (recallScore === RecallScore.KNOW) {
        stats.knowCount++;
      } else if (recallScore === RecallScore.CLUE_USED) {
        stats.clueCount++;
      } else {
        stats.dontKnowCount++;
      }

      // Update word in repository
      const now = Date.now();
      const lastReviewedMs = word.memoryLastReviewed
        ? new Date(word.memoryLastReviewed).getTime()
        : null;
      const msSinceLastReview = lastReviewedMs
        ? Math.max(0, now - lastReviewedMs)
        : 0;

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

  const allWords = repo.count();
  view(`Total words available: ${allWords}\n`);

  view("Study by:");
  view("  1 - Number of words (from highest priority)");
  view("  2 - Specific word range (by position number)");

  const modeChoice = await ask("\nYour choice (default: 1): ");
  const mode = modeChoice.trim() || "1";

  if (mode === "2") {
    // Range-based selection
    const startStr = await ask("Start position (1-based, e.g., 5): ");
    const startIndex = parseInt(startStr.trim(), 10);

    if (isNaN(startIndex) || startIndex <= 0) {
      view(s.e("Invalid start position. Cancelled."));
      return;
    }

    const endStr = await ask(`End position (default: ${allWords}): `);
    const endIndex = endStr.trim() ? parseInt(endStr.trim(), 10) : undefined;

    if (endIndex !== undefined && (isNaN(endIndex) || endIndex < startIndex)) {
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
