import { AppError } from "./domain-error.js";
import type { VocabEntry } from "./vocab.types.js";

export function countCueWords(cue: string): number {
  return cue.split(" ").filter(Boolean).length;
}

function normalizeCue(cue: string): string {
  return cue.trim().toLowerCase().replace(/\s+/g, " ");
}

export function validateSenseCue(
  term: string,
  senseCue: string | undefined,
  sameLemmaEntries: VocabEntry[],
): void {
  if (senseCue !== undefined) {
    const wordCount = countCueWords(senseCue);
    if (wordCount < 1 || wordCount > 2) {
      throw new AppError("INVALID_SENSE_CUE", {
        context: {
          term,
          senseCue,
        },
      });
    }
  }

  if (sameLemmaEntries.length === 0) {
    return;
  }

  const missingExistingSenseCueEntries = sameLemmaEntries.filter(
    (entry) => !entry.senseCue || !entry.senseCue.trim(),
  );
  if (missingExistingSenseCueEntries.length > 0) {
    throw new AppError("MISSING_SENSE_CUE", {
      context: {
        term,
        entries: sameLemmaEntries,
        missingExistingSenseCueEntryIds: missingExistingSenseCueEntries.map((entry) => entry.id),
      },
    });
  }

  if (!senseCue) {
    throw new AppError("MISSING_SENSE_CUE", {
      context: {
        term,
        entries: sameLemmaEntries,
      },
    });
  }

  const normalizedCue = normalizeCue(senseCue);
  const hasDuplicateCue = sameLemmaEntries.some(
    (entry) => entry.senseCue && normalizeCue(entry.senseCue) === normalizedCue,
  );
  if (hasDuplicateCue) {
    throw new AppError("SENSE_CUE_DUPLICATE", {
      context: {
        term,
        senseCue,
        entries: sameLemmaEntries,
      },
    });
  }
}
