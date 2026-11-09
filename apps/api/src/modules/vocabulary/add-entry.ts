import { AppError } from "./domain-error.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import { countCueWords, validateSenseCue } from "./sense-cue.js";
import type { CreateVocabEntry, VocabEntry } from "./vocab.types.js";
import {
  formatDisplayTerm,
  normalizeCreateVocabEntryInput,
  normalizeUpdateVocabEntryInput,
  parseTermInput,
} from "./word-normalization.js";

type LookupTermRepo = Pick<VocabRepositoryPort, "findByTerm">;
type LookupLemmaRepo = Pick<VocabRepositoryPort, "findByLemma">;
type LookupFormRepo = Pick<VocabRepositoryPort, "findByForm">;
type CreateLemmaRepo = Pick<VocabRepositoryPort, "findByLemma" | "create">;
type CreateLemmaAtomicRepo = Pick<
  VocabRepositoryPort,
  "findByLemma" | "createWithSenseCueBackfills"
>;

export type SenseCueBackfill = {
  id: number;
  expectedRevision: number;
  senseCue: string;
};

function normalizeLemma(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveLemma(rawTerm: string): string {
  const parsed = parseTermInput(rawTerm);
  if (!parsed.lemma) {
    throw new AppError("MISSING_WORD_INPUT");
  }

  return normalizeLemma(parsed.lemma);
}

export function prepareAddTerm(rawTerm: string): string {
  const parsed = parseTermInput(rawTerm);
  if (!parsed.lemma) {
    throw new AppError("MISSING_WORD_INPUT");
  }

  return formatDisplayTerm(parsed);
}

export function findEntriesByTerm(rawTerm: string, repo: LookupTermRepo): VocabEntry[] {
  return repo.findByTerm(prepareAddTerm(rawTerm));
}

export function findEntriesByLemma(rawTerm: string, repo: LookupLemmaRepo): VocabEntry[] {
  const lemma = resolveLemma(rawTerm);
  return repo.findByLemma(lemma);
}

export function findEntriesByForm(rawTerm: string, repo: LookupFormRepo): VocabEntry[] {
  return repo.findByForm(resolveLemma(rawTerm));
}

export function createEntry(repo: CreateLemmaRepo, input: CreateVocabEntry): VocabEntry {
  const normalizedInput = normalizeCreateVocabEntryInput(input);
  const term = prepareAddTerm(formatDisplayTerm(normalizedInput));
  const sameLemmaEntries = findEntriesByLemma(normalizedInput.lemma, repo);

  validateSenseCue(term, normalizedInput.senseCue, sameLemmaEntries);

  const created = repo.create(normalizedInput);
  if (created.success && created.entry) {
    return created.entry;
  }

  throw new AppError("PERSISTENCE_WRITE_FAILED", {
    context: {
      operation: "create",
      term,
    },
  });
}

function normalizeBackfills(backfills: SenseCueBackfill[]): SenseCueBackfill[] {
  const dedupedById = new Map<number, SenseCueBackfill>();
  for (const backfill of backfills) {
    const id = Number.isFinite(backfill.id) ? Math.trunc(backfill.id) : Number.NaN;
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    const normalized = normalizeUpdateVocabEntryInput({ senseCue: backfill.senseCue }).senseCue;
    if (!normalized) {
      throw new AppError("MISSING_SENSE_CUE", {
        context: {
          operation: "create",
        },
      });
    }

    const wordCount = countCueWords(normalized);
    if (wordCount < 1 || wordCount > 2) {
      throw new AppError("INVALID_SENSE_CUE", {
        context: {
          operation: "create",
          senseCue: normalized,
        },
      });
    }

    dedupedById.set(id, { id, expectedRevision: backfill.expectedRevision, senseCue: normalized });
  }

  return [...dedupedById.values()];
}

function applySenseCueBackfills(
  entries: VocabEntry[],
  backfills: SenseCueBackfill[],
  term: string,
): VocabEntry[] {
  if (backfills.length === 0) {
    return entries;
  }

  const byId = new Map(backfills.map((backfill) => [backfill.id, backfill.senseCue]));
  const missingBackfillIds = backfills
    .map((backfill) => backfill.id)
    .filter((id) => !entries.some((entry) => entry.id === id));
  if (missingBackfillIds.length > 0) {
    throw new AppError("WORD_NOT_FOUND_BY_ID", {
      context: {
        operation: "create",
        term,
        id: missingBackfillIds[0],
      },
    });
  }

  return entries.map((entry) => {
    const backfilledCue = byId.get(entry.id);
    if (!backfilledCue) {
      return entry;
    }
    return {
      ...entry,
      senseCue: backfilledCue,
    };
  });
}

export function createEntryWithSenseCueBackfills(
  repo: CreateLemmaAtomicRepo,
  input: CreateVocabEntry,
  backfills: SenseCueBackfill[],
): VocabEntry {
  const normalizedInput = normalizeCreateVocabEntryInput(input);
  const term = prepareAddTerm(formatDisplayTerm(normalizedInput));
  const normalizedBackfills = normalizeBackfills(backfills);
  const sameLemmaEntries = findEntriesByLemma(normalizedInput.lemma, repo);
  const sameLemmaEntriesWithBackfills = applySenseCueBackfills(
    sameLemmaEntries,
    normalizedBackfills,
    term,
  );

  validateSenseCue(term, normalizedInput.senseCue, sameLemmaEntriesWithBackfills);

  const created = repo.createWithSenseCueBackfills(normalizedInput, normalizedBackfills);
  if (created.success && created.entry) {
    return created.entry;
  }

  throw new AppError("PERSISTENCE_WRITE_FAILED", {
    context: {
      operation: "create",
      term,
    },
  });
}
