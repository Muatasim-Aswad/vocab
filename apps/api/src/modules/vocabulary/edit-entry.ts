import { AppError } from "./domain-error.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import type { UpdateVocabEntry, VocabEntry } from "./vocab.types.js";
import {
  filterLemmaFromForms,
  formatDisplayTerm,
  normalizeUpdateVocabEntryInput,
  parseTermInput,
} from "./word-normalization.js";

type EditTermLookupRepo = Pick<VocabRepositoryPort, "findById" | "findByTerm" | "findLast">;
type EditTermUpdateRepo = Pick<VocabRepositoryPort, "findById" | "findByLemma" | "updateById">;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeLemma(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCue(cue: string): string {
  return cue.trim().toLowerCase().replace(/\s+/g, " ");
}

function countCueWords(cue: string): number {
  return cue.split(" ").filter(Boolean).length;
}

function validateSenseCueForEdit(
  currentEntry: VocabEntry,
  updateData: UpdateVocabEntry,
  repo: Pick<VocabRepositoryPort, "findByLemma">,
): void {
  const touchesLemmaOrSenseCue = hasOwn(updateData, "lemma") || hasOwn(updateData, "senseCue");
  if (!touchesLemmaOrSenseCue) {
    return;
  }

  const nextLemma = normalizeLemma(updateData.lemma ?? currentEntry.lemma);
  const sameLemmaEntries = repo.findByLemma(nextLemma, { excludeId: currentEntry.id });
  if (sameLemmaEntries.length === 0) {
    return;
  }

  const nextCue = hasOwn(updateData, "senseCue")
    ? (updateData.senseCue ?? "")
    : (currentEntry.senseCue ?? "");
  const trimmedCue = nextCue.trim();

  if (!trimmedCue) {
    throw new AppError("MISSING_SENSE_CUE", {
      context: {
        operation: "edit",
        term: nextLemma,
        entries: [currentEntry, ...sameLemmaEntries],
      },
    });
  }

  const wordCount = countCueWords(trimmedCue);
  if (wordCount < 1 || wordCount > 2) {
    throw new AppError("INVALID_SENSE_CUE", {
      context: {
        operation: "edit",
        term: nextLemma,
        senseCue: trimmedCue,
      },
    });
  }

  const normalizedCue = normalizeCue(trimmedCue);
  const hasDuplicateCue = sameLemmaEntries.some(
    (entry) => entry.senseCue && normalizeCue(entry.senseCue) === normalizedCue,
  );
  if (hasDuplicateCue) {
    throw new AppError("SENSE_CUE_DUPLICATE", {
      context: {
        operation: "edit",
        term: nextLemma,
        senseCue: trimmedCue,
        entries: [currentEntry, ...sameLemmaEntries],
      },
    });
  }
}

export type ResolvedEditTerm = {
  entry: VocabEntry;
  updateId: number;
  displayTerm: string;
  matchedBy: "last" | "term" | "id";
  id?: number;
};

export function resolveEditTerm(input: string, repo: EditTermLookupRepo): ResolvedEditTerm {
  const trimmed = input.trim();

  if (!trimmed) {
    const entry = repo.findLast();
    if (!entry) {
      throw new AppError("VOCAB_EMPTY", {
        context: {
          operation: "edit",
        },
      });
    }

    return {
      entry,
      updateId: entry.id,
      displayTerm: formatDisplayTerm(entry),
      matchedBy: "last",
    };
  }

  const idMatch = trimmed.match(/^(\d+)$/);
  if (idMatch) {
    const id = Number.parseInt(idMatch[1]!, 10);
    const entry = repo.findById(id);
    if (!entry) {
      throw new AppError("WORD_NOT_FOUND_BY_ID", {
        context: {
          id,
          operation: "edit",
        },
      });
    }

    return {
      entry,
      updateId: entry.id,
      displayTerm: formatDisplayTerm(entry),
      matchedBy: "id",
      id,
    };
  }

  const normalizedTerm = formatDisplayTerm(parseTermInput(trimmed));
  const entries = repo.findByTerm(normalizedTerm);
  if (entries.length === 0) {
    throw new AppError("WORD_NOT_FOUND", {
      context: {
        term: normalizedTerm,
        operation: "edit",
      },
    });
  }

  if (entries.length > 1) {
    throw new AppError("WORD_AMBIGUOUS", {
      context: {
        term: normalizedTerm,
        operation: "edit",
        entries,
      },
    });
  }

  const entry = entries[0]!;

  return {
    entry,
    updateId: entry.id,
    displayTerm: normalizedTerm,
    matchedBy: "term",
  };
}

export function applyEditTerm(
  repo: EditTermUpdateRepo,
  id: number,
  updateData: UpdateVocabEntry,
): VocabEntry {
  const normalizedUpdateData = normalizeUpdateVocabEntryInput(updateData);

  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError("NO_CHANGES", {
      context: {
        operation: "edit",
        id,
      },
    });
  }

  const currentEntry = repo.findById(id);
  if (!currentEntry) {
    throw new AppError("WORD_NOT_FOUND", {
      context: {
        id,
        operation: "edit",
      },
    });
  }

  if (hasOwn(normalizedUpdateData, "forms")) {
    const nextLemma = normalizedUpdateData.lemma ?? currentEntry.lemma;
    const filteredForms = filterLemmaFromForms(normalizedUpdateData.forms, nextLemma, {
      preserveEmpty: true,
    });
    if (filteredForms !== undefined) {
      normalizedUpdateData.forms = filteredForms;
    } else {
      delete normalizedUpdateData.forms;
    }
  }

  if (Object.keys(normalizedUpdateData).length === 0) {
    throw new AppError("NO_CHANGES", {
      context: {
        operation: "edit",
        id,
      },
    });
  }

  if (updateData.expectedRevision !== undefined)
    normalizedUpdateData.expectedRevision = updateData.expectedRevision;

  validateSenseCueForEdit(currentEntry, normalizedUpdateData, repo);

  const result = repo.updateById(id, normalizedUpdateData);
  if (result.success && result.entry) {
    return result.entry;
  }

  if (result.found === false) {
    throw new AppError("WORD_NOT_FOUND", {
      context: {
        id,
        operation: "edit",
      },
    });
  }

  throw new AppError("PERSISTENCE_WRITE_FAILED", {
    context: {
      operation: "edit",
      id,
    },
  });
}
