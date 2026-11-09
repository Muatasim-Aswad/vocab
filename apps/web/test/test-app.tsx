import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createApiClient } from "@vocab/api-client";
import { createMemoryRouter } from "react-router-dom";
import { vi } from "vite-plus/test";
import { z } from "zod";

import { App } from "../src/app/App.tsx";
import { createI18n } from "../src/app/i18n.ts";
import { appRoutes } from "../src/app/routes.tsx";
import type { Locale } from "../src/infra/preferences.ts";

// Component-test harness: the real client, contracts and app over a scripted fake fetch.
// It covers UI behavior; e2e/ covers the real API.

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  signal: AbortSignal | undefined;
}

export const requestTerm = (body: unknown) => z.object({ term: z.string() }).parse(body).term;
export const requestToken = (body: unknown) => z.object({ token: z.string() }).parse(body).token;

export type FakeHandler = (request: FakeRequest) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-1" },
  });

export const apiError = (status: number, code: string, message: string) =>
  json({ error: { status, code, message, request_id: "req-1" } }, status);

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export const summary = (id: number, lemma: string, extra: Record<string, unknown> = {}) => ({
  id,
  revision: 1,
  lemma,
  status: "active" as const,
  ...extra,
});

export const detail = (id: number, lemma: string, extra: Record<string, unknown> = {}) => ({
  entry: {
    id,
    revision: 1,
    lemma,
    status: "active" as const,
    language: "nl",
    meta: { addedAt: "2024-01-02T10:00:00.000Z", modifiedAt: "2024-03-04T12:30:00.000Z" },
    ...extra,
  },
  relations: [],
  siblings: [],
});

export const capture = (id: number, term: string, createdAt = "2026-09-30T10:00:00.000Z") => ({
  id: `0192a6b4-0000-7000-8000-${String(id).padStart(12, "0")}`,
  term,
  createdAt,
});

export const capturePage = (items: unknown[], next: string | null = null) => ({
  items,
  metadata: { next_cursor: next },
});

export const page = (items: unknown[], next: string | null = null) => ({
  items,
  total: items.length,
  metadata: { next_cursor: next },
});

function matcher(key: string) {
  const [method, path] = key.split(" ");
  const pattern = new RegExp(`^${path.replace(/:[a-z]+/g, "[^/]+")}$`);
  return (request: FakeRequest) => request.method === method && pattern.test(request.path);
}

/** Routes requests to handlers keyed like `GET /api/entries/:id`; unknown routes fail as offline. */
function fakeFetch(handlers: Record<string, FakeHandler>) {
  const calls: FakeRequest[] = [];
  const routes = Object.entries(handlers).map(([key, handler]) => [matcher(key), handler] as const);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://vocab.test",
    );
    const request: FakeRequest = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal ?? undefined,
    };
    calls.push(request);
    const handler = routes.find(([matches]) => matches(request))?.[1];
    if (!handler) throw new TypeError("fetch failed");
    const signal = request.signal;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      Promise.resolve(handler(request)).then(resolve, reject);
    });
  });
  return { fetch, calls };
}

export function renderApp({
  handlers = {},
  path = "/",
  locale = "en",
}: {
  handlers?: Record<string, FakeHandler>;
  path?: string;
  locale?: Locale;
} = {}) {
  const { fetch, calls } = fakeFetch({
    "GET /api/auth/session": () => json({ authenticated: true }),
    "GET /api/captures": () => json({ items: [], metadata: { next_cursor: null } }),
    "GET /api/entries": () => json(page([])),
    "GET /api/search-history": () => json({ terms: [] }),
    "POST /api/search-history": (request) => json(request.body),
    "POST /api/search-history/clears": (request) => json(request.body),
    ...handlers,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } },
  });
  const i18n = createI18n(locale);
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(
    <App api={createApiClient({ fetch })} queryClient={queryClient} i18n={i18n} router={router} />,
  );
  const callsTo = (method: string, requestPath: string) =>
    calls.filter((call) => call.method === method && call.path === requestPath);
  return { ...view, router, calls, callsTo, fetch, i18n, queryClient };
}
