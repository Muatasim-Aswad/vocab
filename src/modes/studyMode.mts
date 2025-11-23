import { ask, s, view } from "../ui/terminal.mjs";
import { VocabRepository, Vocab } from "../data/repository.mjs";
import { DecayStore } from "../data/decayStore.mjs";

const BETA = 0.1; // Decay factor for priority calculation
const DAILY_DECAY_RATE = 0.98;

export interface StudyStats {
  totalWords: number;
  wordsReviewed: number;
  knowCount: number;
  dontKnowCount: number;
  clueCount: number;
}

enum RecallScore {
  DONT_KNOW = 0,
  CLUE_USED = 1,
  KNOW = 2,
}

interface WordWithPriority extends Vocab {
  priority: number;
}

/**
 * Calculate priority for each word based on strength and time since last review
 */
function calculatePriority(word: Vocab, beta: number): number {
  const strength = word.memorizationStrength ?? 0;
  const lastReviewed = word.lastReviewed ? new Date(word.lastReviewed) : null;

  if (!lastReviewed) {
    // Never reviewed - high priority
    return -1000;
  }

  const now = new Date();
  const daysSince = (now.getTime() - lastReviewed.getTime()) / (1000 * 60 * 60 * 24);

  // Lower priority = needs more review
  return strength - beta * daysSince;
}

/**
 * Sort words by priority (ascending - lowest priority first)
 */
function sortByPriority(words: Vocab[], beta: number): WordWithPriority[] {
  const wordsWithPriority = words.map((word) => ({
    ...word,
    priority: calculatePriority(word, beta),
  }));

  return wordsWithPriority.sort((a, b) => a.priority - b.priority);
}

/**
 * Update word strength based on recall score
 */
function updateStrength(word: Vocab, recallScore: RecallScore): number {
  let strength = word.memorizationStrength ?? 0;

  switch (recallScore) {
    case RecallScore.KNOW:
      strength += 3;
      break;
    case RecallScore.CLUE_USED:
      strength += 1;
      break;
    case RecallScore.DONT_KNOW:
      strength -= 1;
      break;
  }

  // Clamp between 0 and 100
  return Math.max(0, Math.min(100, strength));
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

  // Display current strength
  const strength = word.memorizationStrength ?? 0;
  const strengthBar =
    "█".repeat(Math.floor(strength / 5)) + "░".repeat(20 - Math.floor(strength / 5));
  view(`\nStrength: [${strengthBar}] ${strength}/100`);
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
async function reviewWord(word: Vocab, index: number, total: number): Promise<RecallScore> {
  let clueLevel = 0; // 0 = no clue, 1 = example, 2 = related

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
      return clueLevel > 0 ? RecallScore.CLUE_USED : RecallScore.KNOW;
    } else if (choice === "d") {
      // Show all info before moving on
      console.clear();
      displayWordForStudy(word, index, total);
      displayExampleClue(word);
      displayRelatedClue(word);
      view(`\n${s.e("Study this word carefully!")}`);
      await ask("\nPress Enter to continue...");
      return RecallScore.DONT_KNOW;
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
): Promise<void> {
  const allWords = repo.getAll();

  if (allWords.length === 0) {
    view(s.e("No words available to study. Add some words first!"));
    return;
  }

  // Sort by priority and take the specified number of words
  const sortedWords = sortByPriority(allWords, BETA);
  const sessionWords = sortedWords.slice(0, Math.min(maxWords, sortedWords.length));

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

      const recallScore = await reviewWord(word, i, sessionWords.length);

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
      const newStrength = updateStrength(word, recallScore);
      repo.update(word.word, {
        memorizationStrength: newStrength,
        lastReviewed: new Date().toISOString(),
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
 * Apply daily decay to all words
 * @param repo - The vocabulary repository
 * @param silent - If true, don't display output messages
 * @returns Number of words that were decayed
 */
export function applyDailyDecay(repo: VocabRepository, silent: boolean = false): number {
  const allWords = repo.getAll();
  let decayedCount = 0;

  for (const word of allWords) {
    if (word.memorizationStrength !== undefined && word.memorizationStrength > 0) {
      const newStrength = Math.floor(word.memorizationStrength * DAILY_DECAY_RATE);
      if (newStrength !== word.memorizationStrength) {
        repo.update(word.word, {
          memorizationStrength: newStrength,
        });
        decayedCount++;
      }
    }
  }

  if (!silent) {
    view(s.aH(`\n✓ Daily decay applied to ${decayedCount} words.`));
  }

  return decayedCount;
}

/**
 * Apply multiple days of decay to all words
 * @param repo - The vocabulary repository
 * @param days - Number of days of decay to apply
 * @param silent - If true, don't display output messages
 * @returns Number of words that were decayed
 */
export function applyMultipleDaysDecay(
  repo: VocabRepository,
  days: number,
  silent: boolean = false,
): number {
  const allWords = repo.getAll();
  let decayedCount = 0;

  for (const word of allWords) {
    if (word.memorizationStrength !== undefined && word.memorizationStrength > 0) {
      const newStrength = Math.floor(word.memorizationStrength * Math.pow(DAILY_DECAY_RATE, days));
      if (newStrength !== word.memorizationStrength) {
        repo.update(word.word, {
          memorizationStrength: newStrength,
        });
        decayedCount++;
      }
    }
  }

  if (!silent) {
    view(s.aH(`\n✓ Applied ${days} day(s) of decay to ${decayedCount} words.`));
  }

  return decayedCount;
}

/**
 * Check for overdue decay and apply if needed
 * @param repo - The vocabulary repository
 * @param decayStore - The decay timestamp store
 * @param silent - If true, don't display output messages
 */
export function checkAndApplyOverdueDecay(
  repo: VocabRepository,
  decayStore: DecayStore,
  silent: boolean = false,
): void {
  const daysSinceLastDecay = decayStore.getDaysSinceLastDecay();

  if (daysSinceLastDecay === null) {
    // First time running - initialize decay timestamp
    if (!silent) {
      view("Initializing decay tracking...");
    }
    decayStore.updateLastDecayDate();
    return;
  }

  if (daysSinceLastDecay > 0) {
    if (!silent) {
      view(`Applying ${daysSinceLastDecay} day(s) of overdue decay...`);
    }
    applyMultipleDaysDecay(repo, daysSinceLastDecay, silent);
    decayStore.updateLastDecayDate();
  }
}

/**
 * Configure study session parameters
 */
export async function configureStudySession(repo: VocabRepository): Promise<void> {
  view(s.aH("\n📚 Study Session Configuration"));

  const maxWordsStr = await ask("How many words do you want to study? (default: 20): ");
  const maxWords = maxWordsStr.trim() ? parseInt(maxWordsStr.trim(), 10) : 20;

  if (isNaN(maxWords) || maxWords <= 0) {
    view(s.e("Invalid number. Using default: 20"));
    await startStudySession(repo, 20);
  } else {
    await startStudySession(repo, maxWords);
  }
}
