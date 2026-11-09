import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError } from "@vocab/api-client";
import { useCallback, useRef, useState } from "react";

import { useApi } from "../../infra/api-context.ts";
import { uuidV7 } from "../../shared/uuid.ts";
import { isUnauthorized, useSession } from "../session/index.ts";
import { describeError, mayHaveCommitted, type Problem } from "./errors.ts";
import type { Capture, CapturePage } from "./types.ts";

const pageSize = 20;
const writeTimeoutMs = 20_000;

/** The API's capture identity: case-insensitive, with trimmed and collapsed spacing. */
const termKey = (term: string) => term.trim().replace(/\s+/g, " ").toLowerCase();

/** Every paged list shares the `list` prefix, so one update or invalidation reaches them all. */
export const captureKeys = {
  all: ["captures"] as const,
  list: ["captures", "list"] as const,
  startingWith: (prefix: string) => ["captures", "list", termKey(prefix)] as const,
  term: (term: string) => ["captures", "term", termKey(term)] as const,
};

function useCapturePages(prefix?: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: prefix === undefined ? captureKeys.list : captureKeys.startingWith(prefix),
    enabled: prefix === undefined || termKey(prefix) !== "",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listCaptures(
        {
          limit: pageSize,
          ...(pageParam && { cursor: pageParam }),
          ...(prefix !== undefined && { prefix }),
        },
        { signal },
      ),
    getNextPageParam: (page) => page.metadata.next_cursor ?? undefined,
  });
}

export const useCaptureList = () => useCapturePages();

/** Captured terms starting with `prefix`, newest first. */
export const useCapturesStartingWith = (prefix: string) => useCapturePages(prefix);

/** The capture for exactly this term, or `null`; lookups fail quietly for callers. */
export function useCapturedTerm(term: string) {
  const api = useApi();
  return useQuery({
    queryKey: captureKeys.term(term),
    enabled: termKey(term) !== "",
    queryFn: async ({ signal }) =>
      (await api.listCaptures({ term, limit: 1 }, { signal })).items[0] ?? null,
  });
}

function forgetCapture(queryClient: QueryClient, capture: Capture) {
  queryClient.setQueriesData<InfiniteData<CapturePage>>({ queryKey: captureKeys.list }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== capture.id),
          })),
        }
      : data,
  );
  queryClient.setQueryData(captureKeys.term(capture.term), null);
}

export type WriteState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "failed"; problem: Problem; unauthorized: boolean; uncertain: boolean };

/**
 * A write that may be retried: an unconfirmed attempt keeps its mutation identity until the API
 * confirms or rejects it, so repeating it never applies the change twice.
 */
function useRetryableWrite<Input, Result>(
  identity: (input: Input) => string,
  send: (input: Input, mutationId: string, signal: AbortSignal) => Promise<Result>,
) {
  const { requireLogin } = useSession();
  const attempt = useRef<{ key: string; mutationId: string } | null>(null);
  const busy = useRef(false);
  const [state, setState] = useState<WriteState>({ status: "idle" });

  const run = useCallback(
    async (input: Input): Promise<Result | undefined> => {
      if (busy.current) return undefined;
      const key = identity(input);
      if (attempt.current?.key !== key) attempt.current = { key, mutationId: uuidV7() };
      busy.current = true;
      setState({ status: "saving" });
      try {
        const result = await send(
          input,
          attempt.current.mutationId,
          AbortSignal.timeout(writeTimeoutMs),
        );
        attempt.current = null;
        setState({ status: "idle" });
        return result;
      } catch (error) {
        const unauthorized = isUnauthorized(error);
        const uncertain = !unauthorized && mayHaveCommitted(error);
        if (unauthorized) requireLogin();
        else if (!uncertain) attempt.current = null;
        setState({ status: "failed", problem: describeError(error), unauthorized, uncertain });
        return undefined;
      } finally {
        busy.current = false;
      }
    },
    [identity, send, requireLogin],
  );
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { run, state, reset };
}

export function useCaptureTerm() {
  const api = useApi();
  const queryClient = useQueryClient();
  const send = useCallback(
    async (term: string, mutationId: string, signal: AbortSignal) => {
      const saved = await api.createCapture({ mutationId, term: term.trim() }, { signal });
      queryClient.setQueryData(captureKeys.term(saved.term), saved);
      void queryClient.invalidateQueries({ queryKey: captureKeys.list });
      return saved;
    },
    [api, queryClient],
  );
  return useRetryableWrite(termKey, send);
}

const captureId = (capture: Capture) => capture.id;

/** Removal is idempotent for the user: a capture that is already gone counts as removed. */
export function useRemoveCapture() {
  const api = useApi();
  const queryClient = useQueryClient();
  const send = useCallback(
    async (capture: Capture, mutationId: string, signal: AbortSignal) => {
      try {
        await api.deleteCapture(capture.id, { mutationId }, { signal });
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "not_found")) throw error;
      }
      forgetCapture(queryClient, capture);
      return capture;
    },
    [api, queryClient],
  );
  return useRetryableWrite(captureId, send);
}
