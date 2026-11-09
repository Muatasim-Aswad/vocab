import { AppError } from "./domain-error.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import type { EntryListOrder, PaginatedVocabEntryResult } from "./vocab.types.js";

type ListWordsRepo = Pick<VocabRepositoryPort, "paginate">;

export type ListEntriesInput = {
  cursor?: number;
  limit?: number;
  typeFilter?: string;
  order?: EntryListOrder;
};

export function listEntries(
  repo: ListWordsRepo,
  input: ListEntriesInput,
): PaginatedVocabEntryResult {
  const { cursor, limit, typeFilter, order } = input;
  const page = repo.paginate({ cursor, limit, typeFilter, order });

  if (page.total === 0) {
    if (typeFilter) {
      throw new AppError("NO_WORDS_FOR_FILTER", {
        context: {
          typeFilter,
          operation: "list",
        },
      });
    }

    throw new AppError("VOCAB_EMPTY", {
      context: {
        operation: "list",
      },
    });
  }

  if (page.entries.length === 0 && cursor !== undefined) {
    throw new AppError("CURSOR_OUT_OF_RANGE", {
      context: {
        cursor,
        total: page.total,
        limit: page.limit,
        operation: "list",
      },
    });
  }

  return page;
}
