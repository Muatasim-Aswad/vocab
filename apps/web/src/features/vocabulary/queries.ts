import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "@vocab/api-client";

import { useApi } from "../../infra/api-context.ts";
import type { SearchItem } from "./types.ts";

export type EntryOrder = "added" | "modified" | "alphabetical";

export interface ListParams {
  order: EntryOrder;
  type: string;
}

export interface SearchParams {
  query: string;
  type: string;
  includeExamples: boolean;
}

const pageSize = 20;
const recentCount = 10;

export const entryKeys = {
  all: ["entries"] as const,
  search: (params: SearchParams) => ["entries", "search", params] as const,
  recent: ["entries", "recent"] as const,
  list: (params: ListParams) => ["entries", "list", params] as const,
  detail: (id: number) => ["entries", "detail", id] as const,
};

/**
 * Ranked search pages in server order. The previous query's results stay visible while a new
 * query loads, but every page records the query it answers so the UI can label them.
 */
export function useSearchResults(params: SearchParams) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: entryKeys.search(params),
    enabled: params.query !== "",
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await api.searchEntries(
        {
          query: params.query,
          limit: pageSize,
          ...(pageParam && { cursor: pageParam }),
          ...(params.type && { typeFilter: params.type }),
          ...(params.includeExamples && { includeAllFields: true }),
        },
        { signal },
      );
      return { ...page, params };
    },
    getNextPageParam: (page) => page.metadata.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Appended pages can overlap after concurrent writes; keep the first occurrence of each entry. */
export function distinctEntries(pages: { items: SearchItem[] }[]): SearchItem[] {
  const seen = new Set<number>();
  const result: SearchItem[] = [];
  for (const page of pages)
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  return result;
}

export function useEntry(id: number | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: entryKeys.detail(id ?? 0),
    enabled: id !== undefined,
    queryFn: ({ signal }) => api.getEntry(id!, { signal }),
  });
}

/** Active entries whose content changed most recently, new ones included; stubs are never listed. */
export function useRecentEntries() {
  const api = useApi();
  return useQuery({
    queryKey: entryKeys.recent,
    queryFn: async ({ signal }) =>
      (await api.listEntries({ limit: recentCount, order: "modified" }, { signal })).items,
  });
}

/** Every active entry in the chosen order, paged; a filter that matches nothing is an empty list. */
export function useEntryList(params: ListParams) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: entryKeys.list(params),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await api.listEntries(
          {
            limit: pageSize,
            order: params.order,
            ...(pageParam && { cursor: pageParam }),
            ...(params.type && { typeFilter: params.type }),
          },
          { signal },
        );
      } catch (error) {
        if (!pageParam && error instanceof ApiError && error.code === "not_found")
          return { items: [], total: 0, metadata: { next_cursor: null } };
        throw error;
      }
    },
    getNextPageParam: (page) => page.metadata.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
