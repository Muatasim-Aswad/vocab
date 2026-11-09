import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useApi } from "../../infra/api-context.ts";
import { uuidV7 } from "../../shared/uuid.ts";

const recentSearchesKey = ["recent-searches"] as const;
const historySize = 50;

const tidy = (term: string) => term.trim().replace(/\s+/g, " ");
const sameTerm = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Moves `term` to the front, dropping case and spacing variants of it. */
function withRecentSearch(terms: readonly string[], term: string): string[] {
  const clean = tidy(term);
  if (!clean) return [...terms];
  return [clean, ...terms.filter((item) => !sameTerm(item, clean))].slice(0, historySize);
}

/**
 * Server-kept recent searches, up to the server's limit. Writes show at once and are sent without waiting; a failed write
 * is dropped, and the next successful read restores the server's list.
 */
export function useRecentSearches() {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: recentSearchesKey,
    queryFn: async ({ signal }) =>
      (await api.listRecentSearches({ limit: historySize }, { signal })).terms,
  });

  const append = useCallback(
    (update: (terms: string[]) => string[], send: () => Promise<unknown>) => {
      void queryClient.cancelQueries({ queryKey: recentSearchesKey });
      queryClient.setQueryData<string[]>(recentSearchesKey, (terms) => terms && update(terms));
      void send()
        .catch(() => undefined)
        .finally(() => queryClient.invalidateQueries({ queryKey: recentSearchesKey }));
    },
    [queryClient],
  );

  const record = useCallback(
    (term: string) => {
      const clean = tidy(term);
      if (!clean) return;
      append(
        (terms) => withRecentSearch(terms, clean),
        () => api.recordSearch({ id: uuidV7(), term: clean, searchedAt: new Date().toISOString() }),
      );
    },
    [api, append],
  );

  const clear = useCallback(
    () =>
      append(
        () => [],
        () => api.clearSearchHistory({ id: uuidV7(), clearedAt: new Date().toISOString() }),
      ),
    [api, append],
  );

  return {
    terms: query.data ?? [],
    loading: query.isPending,
    failed: query.isError && !query.data,
    retry: () => void query.refetch(),
    record,
    clear,
  };
}
