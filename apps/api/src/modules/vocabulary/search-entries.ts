import { AppError } from "./domain-error.js";
import type { VocabRepositoryPort } from "./repository.types.js";
import type { PaginatedVocabEntryResult, SearchQueryOptions } from "./vocab.types.js";

type SearchRepo = Pick<VocabRepositoryPort, "search">;

export type SearchEntriesOptions = SearchQueryOptions & {
  keepWhitespace?: boolean;
  highlightAll?: boolean;
  showExtra?: boolean;
};

export type SearchEntriesResult = {
  query: string;
  options: SearchEntriesOptions;
  page: PaginatedVocabEntryResult;
};

export function searchEntries(
  repo: SearchRepo,
  params: {
    query: string;
    options: SearchEntriesOptions;
  },
): SearchEntriesResult {
  const { query } = params;
  const options: SearchEntriesOptions = { ...params.options };

  if (!query.trim()) {
    throw new AppError("EMPTY_SEARCH_QUERY", {
      context: {
        operation: "search",
      },
    });
  }

  const page = repo.search(query, options);

  if (page.entries.length === 0 && options.cursor !== undefined && page.total > 0) {
    throw new AppError("CURSOR_OUT_OF_RANGE", {
      context: {
        cursor: options.cursor,
        total: page.total,
        limit: page.limit,
        operation: "search",
      },
    });
  }

  return { query, options, page };
}
