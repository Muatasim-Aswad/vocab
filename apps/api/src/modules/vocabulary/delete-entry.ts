import { AppError } from "./domain-error.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import type { VocabEntry } from "./vocab.types.js";
import { formatDisplayTerm, parseTermInput } from "./word-normalization.js";

type DeleteTermLookupRepo = Pick<VocabRepositoryPort, "findById" | "findByTerm" | "findLast">;
type DeleteTermRepo = Pick<VocabRepositoryPort, "deleteById">;

export function resolveDeleteTerm(input: string, repo: DeleteTermLookupRepo): VocabEntry {
  const trimmed = input ? input.trim() : "";

  if (trimmed) {
    const idMatch = trimmed.match(/^(\d+)$/);
    if (idMatch) {
      const id = Number.parseInt(idMatch[1]!, 10);
      const entry = repo.findById(id);
      if (!entry) {
        throw new AppError("WORD_NOT_FOUND_BY_ID", {
          context: {
            id,
            operation: "delete",
          },
        });
      }

      return entry;
    }

    const term = formatDisplayTerm(parseTermInput(trimmed));
    const entries = repo.findByTerm(term);
    if (entries.length === 0) {
      throw new AppError("WORD_NOT_FOUND", {
        context: {
          term,
          operation: "delete",
        },
      });
    }

    if (entries.length > 1) {
      throw new AppError("WORD_AMBIGUOUS", {
        context: {
          term,
          operation: "delete",
          entries,
        },
      });
    }

    return entries[0]!;
  }

  const entry = repo.findLast();
  if (!entry) {
    throw new AppError("VOCAB_EMPTY", {
      context: {
        operation: "delete",
      },
    });
  }

  return entry;
}

export function deleteTerm(repo: DeleteTermRepo, id: number): VocabEntry {
  const result = repo.deleteById(id);
  if (result.success && result.entry) {
    return result.entry;
  }

  if (result.found === false) {
    throw new AppError("WORD_NOT_FOUND_BY_ID", {
      context: {
        id,
        operation: "delete",
      },
    });
  }

  throw new AppError("PERSISTENCE_WRITE_FAILED", {
    context: {
      operation: "delete",
      id,
    },
  });
}
