import {
  apiErrorResponse,
  readinessFailureDetails,
  requestIdHeader,
  routes,
  type ReadinessChecks,
  type RouteContract,
} from "@vocab/contracts";
import type { z } from "zod";

import { ApiError, ApiNetworkError, ApiResponseError } from "./errors.ts";

export interface ApiClientOptions {
  /** API origin, such as `https://vocab.example`; empty for same-origin requests. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Browser mode sends and receives the HttpOnly session cookie. */
  credentials?: RequestCredentials;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface AuthenticatedRequestOptions extends RequestOptions {
  /** Bearer token. Sent only in the `Authorization` header. */
  token?: string;
}

export type Readiness =
  | { ready: true; checks: ReadinessChecks }
  | { ready: false; checks: ReadinessChecks; requestId: string };

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({
  baseUrl = "",
  fetch: fetchFn = globalThis.fetch,
  credentials = "same-origin",
}: ApiClientOptions = {}) {
  async function request<Schema extends z.ZodType>(
    route: RouteContract & { response: Schema },
    {
      signal,
      token,
      params,
      query,
      body,
    }: RequestOptions & {
      token?: string;
      params?: Record<string, string | number>;
      query?: Record<string, unknown>;
      body?: unknown;
    },
  ): Promise<z.output<Schema>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const path = route.path.replace(/:([A-Za-z_]+)/g, (_match, key: string) => {
      const value = params?.[key];
      if (value === undefined) throw new TypeError(`Missing route parameter ${key}`);
      return encodeURIComponent(String(value));
    });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        search.set(key, String(value));
      else if (value !== undefined) throw new TypeError(`Invalid query parameter ${key}`);
    }
    const url = `${baseUrl}${path}${search.size ? `?${search}` : ""}`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: route.method,
        headers,
        signal,
        credentials,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      // Callers cancel on purpose; keep AbortError distinguishable.
      if (signal?.aborted) throw error;
      throw new ApiNetworkError(`Could not reach the API: ${route.method} ${route.path}`, {
        cause: error,
      });
    }

    const requestId = response.headers.get(requestIdHeader) ?? undefined;
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (error) {
      throw new ApiResponseError(
        `Response is not JSON (HTTP ${response.status})`,
        response.status,
        requestId,
        {
          cause: error,
        },
      );
    }

    if (response.ok) {
      const parsed = route.response.safeParse(responseBody);
      if (!parsed.success) {
        throw new ApiResponseError(
          "Response does not match its contract",
          response.status,
          requestId,
          {
            cause: parsed.error,
          },
        );
      }
      return parsed.data;
    }

    const parsed = apiErrorResponse.safeParse(responseBody);
    if (!parsed.success || parsed.data.error.status !== response.status) {
      throw new ApiResponseError(
        `Unexpected error response (HTTP ${response.status})`,
        response.status,
        requestId,
        {
          cause: parsed.error,
        },
      );
    }
    throw new ApiError(parsed.data);
  }

  return {
    liveness: (options: RequestOptions = {}) => request(routes.liveness, options),
    openapi: (options: RequestOptions = {}) => request(routes.openapi, options),

    /** Resolves `ready: false` for the API's 503 readiness failure; other errors throw. */
    async readiness(options: RequestOptions = {}): Promise<Readiness> {
      try {
        const { checks } = await request(routes.readiness, options);
        return { ready: true, checks };
      } catch (error) {
        if (error instanceof ApiError && error.code === "unavailable") {
          const details = readinessFailureDetails.safeParse(error.details);
          if (details.success)
            return { ready: false, checks: details.data.checks, requestId: error.requestId };
        }
        throw error;
      }
    },

    status: (options: AuthenticatedRequestOptions) => request(routes.status, options),
    login: (body: z.input<typeof routes.login.body>, options: RequestOptions = {}) =>
      request(routes.login, { ...options, body }),
    logout: (options: AuthenticatedRequestOptions = {}) => request(routes.logout, options),
    authState: (options: AuthenticatedRequestOptions = {}) => request(routes.authState, options),
    listCaptures: (
      query: z.input<typeof routes.listCaptures.query> = {},
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.listCaptures, { ...options, query }),
    getCapture: (id: string, options: AuthenticatedRequestOptions = {}) =>
      request(routes.getCapture, { ...options, params: { id } }),
    createCapture: (
      body: z.input<typeof routes.createCapture.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.createCapture, { ...options, body }),
    deleteCapture: (
      id: string,
      body: z.input<typeof routes.deleteCapture.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.deleteCapture, { ...options, params: { id }, body }),
    listRecentSearches: (
      query: z.input<typeof routes.listRecentSearches.query> = {},
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.listRecentSearches, { ...options, query }),
    recordSearch: (
      body: z.input<typeof routes.recordSearch.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.recordSearch, { ...options, body }),
    clearSearchHistory: (
      body: z.input<typeof routes.clearSearchHistory.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.clearSearchHistory, { ...options, body }),
    searchEntries: (
      query: z.input<typeof routes.searchEntries.query>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.searchEntries, { ...options, query }),
    listEntries: (
      query: z.input<typeof routes.listEntries.query> = {},
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.listEntries, { ...options, query }),
    getEntry: (id: number, options: AuthenticatedRequestOptions = {}) =>
      request(routes.getEntry, { ...options, params: { id } }),
    lookupEntry: (term: string, options: AuthenticatedRequestOptions = {}) =>
      request(routes.lookupEntry, { ...options, query: { term } }),
    prepareEntry: (
      body: z.input<typeof routes.prepareEntry.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.prepareEntry, { ...options, body }),
    resolveForms: (
      body: z.input<typeof routes.resolveForms.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.resolveForms, { ...options, body }),
    createEntry: (
      body: z.input<typeof routes.createEntry.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.createEntry, { ...options, body }),
    updateEntry: (
      id: number,
      body: z.input<typeof routes.updateEntry.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.updateEntry, { ...options, params: { id }, body }),
    deleteEntry: (
      id: number,
      body: z.input<typeof routes.deleteEntry.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.deleteEntry, { ...options, params: { id }, body }),
    studyInventory: (options: AuthenticatedRequestOptions = {}) =>
      request(routes.studyInventory, options),
    startStudy: (
      body: z.input<typeof routes.startStudy.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.startStudy, { ...options, body }),
    getStudy: (id: string, options: AuthenticatedRequestOptions = {}) =>
      request(routes.getStudy, { ...options, params: { id } }),
    answerStudy: (
      id: string,
      body: z.input<typeof routes.answerStudy.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.answerStudy, { ...options, params: { id }, body }),
    endStudy: (
      id: string,
      body: z.input<typeof routes.endStudy.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.endStudy, { ...options, params: { id }, body }),
    listStudyHistory: (
      query: z.input<typeof routes.listStudyHistory.query> = {},
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.listStudyHistory, { ...options, query }),
    getStudyHistory: (id: string, options: AuthenticatedRequestOptions = {}) =>
      request(routes.getStudyHistory, { ...options, params: { id } }),
    generateDraft: (
      body: z.input<typeof routes.generateDraft.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.generateDraft, { ...options, body }),
    matchMeaning: (
      body: z.input<typeof routes.matchMeaning.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.matchMeaning, { ...options, body }),
    recordAiDraftEvent: (
      body: z.input<typeof routes.recordAiDraftEvent.body>,
      options: AuthenticatedRequestOptions = {},
    ) => request(routes.recordAiDraftEvent, { ...options, body }),
  };
}
