import { z } from "zod";

import {
  aiDraftEventBody,
  aiDraftEventResponse,
  generateBody,
  generateResponse,
  matchMeaningBody,
  meaningMatch,
} from "./ai.ts";
import { authState, loginBody } from "./auth.ts";
import {
  capture,
  captureIdParams,
  capturePage,
  createCaptureBody,
  deleteCaptureBody,
  listCapturesQuery,
} from "./captures.ts";
import { appStatus, liveness, readiness } from "./health.ts";
import {
  recentSearches,
  recentSearchesQuery,
  searchHistoryClear,
  searchRecord,
} from "./search-history.ts";
import {
  answerStudyBody,
  answerStudyResponse,
  endStudyBody,
  startStudyBody,
  studyHistoryPage,
  studyHistoryParams,
  studyHistoryQuery,
  studyHistoryRecord,
  studyInventory,
  studySession,
  studySessionParams,
} from "./study.ts";
import {
  createEntryBody,
  deleteEntryBody,
  entryDetail,
  entryIdParams,
  entryPage,
  entryQuery,
  formsResolution,
  listEntriesQuery,
  prepareEntryBody,
  preparedEntry,
  resolveFormsBody,
  searchQuery,
  updateEntryBody,
} from "./vocabulary.ts";

/** Header carrying the request correlation ID, in both directions. */
export const requestIdHeader = "x-request-id";

export interface RouteContract {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Absolute path, as served by the API. */
  path: string;
  /** `either` accepts a valid browser session or bearer token. */
  auth: "public" | "bearer" | "either";
  summary: string;
  /** Success (200) body. */
  response: z.ZodType;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  /** Long operations use their own timeout budget. */
  timeoutMs?: number;
}

/** Every API route. The API derives routing, validation, auth, and OpenAPI from these. */
export const routes = {
  liveness: {
    method: "GET",
    path: "/api/health/live",
    auth: "public",
    summary: "Liveness: the process serves HTTP",
    response: liveness,
  },
  readiness: {
    method: "GET",
    path: "/api/health/ready",
    auth: "public",
    summary:
      "Readiness: dependencies are usable; 503 `unavailable` with `details.checks` otherwise",
    response: readiness,
  },
  status: {
    method: "GET",
    path: "/api/status",
    auth: "bearer",
    summary: "Application status",
    response: appStatus,
  },
  openapi: {
    method: "GET",
    path: "/api/openapi.json",
    auth: "public",
    summary: "OpenAPI document",
    response: z.record(z.string(), z.unknown()),
  },
  login: {
    method: "POST",
    path: "/api/auth/login",
    auth: "public",
    summary: "Exchange personal token for a browser session",
    body: loginBody,
    response: authState,
  },
  logout: {
    method: "POST",
    path: "/api/auth/logout",
    auth: "either",
    summary: "Revoke this browser session",
    response: authState,
  },
  authState: {
    method: "GET",
    path: "/api/auth/session",
    auth: "either",
    summary: "Current authentication state",
    response: authState,
  },
  listCaptures: {
    method: "GET",
    path: "/api/captures",
    auth: "either",
    summary: "List captured terms, newest first; optionally match one term or a term prefix",
    query: listCapturesQuery,
    response: capturePage,
  },
  getCapture: {
    method: "GET",
    path: "/api/captures/:id",
    auth: "either",
    summary: "Read one captured term",
    params: captureIdParams,
    response: capture,
  },
  createCapture: {
    method: "POST",
    path: "/api/captures",
    auth: "either",
    summary: "Capture a term for later; repeat captures of the same term reuse it",
    body: createCaptureBody,
    response: capture,
  },
  deleteCapture: {
    method: "DELETE",
    path: "/api/captures/:id",
    auth: "either",
    summary: "Remove a captured term",
    params: captureIdParams,
    body: deleteCaptureBody,
    response: capture,
  },
  listRecentSearches: {
    method: "GET",
    path: "/api/search-history",
    auth: "either",
    summary: "Distinct recent search terms since the latest clear, newest first",
    query: recentSearchesQuery,
    response: recentSearches,
  },
  recordSearch: {
    method: "POST",
    path: "/api/search-history",
    auth: "either",
    summary: "Append a search; repeating the same ID is a no-op",
    body: searchRecord,
    response: searchRecord,
  },
  clearSearchHistory: {
    method: "POST",
    path: "/api/search-history/clears",
    auth: "either",
    summary: "Hide searches up to this time from the recent list; repeating the same ID is a no-op",
    body: searchHistoryClear,
    response: searchHistoryClear,
  },
  searchEntries: {
    method: "GET",
    path: "/api/entries/search",
    auth: "either",
    summary: "Search vocabulary",
    query: searchQuery,
    response: entryPage,
  },
  listEntries: {
    method: "GET",
    path: "/api/entries",
    auth: "either",
    summary: "List vocabulary: newest, most recently modified, or alphabetical first",
    query: listEntriesQuery,
    response: entryPage,
  },
  getEntry: {
    method: "GET",
    path: "/api/entries/:id",
    auth: "either",
    summary: "Read entry with relation and sibling summaries",
    params: entryIdParams,
    response: entryDetail,
  },
  lookupEntry: {
    method: "GET",
    path: "/api/entries/lookup",
    auth: "either",
    summary: "Find entries by term",
    query: entryQuery,
    response: z.array(entryDetail),
  },
  prepareEntry: {
    method: "POST",
    path: "/api/entries/prepare",
    auth: "either",
    summary: "Normalize and inspect an add term",
    body: prepareEntryBody,
    response: preparedEntry,
  },
  resolveForms: {
    method: "POST",
    path: "/api/entries/forms/resolve",
    auth: "either",
    summary: "Compare supplied and inferred Dutch forms without saving",
    body: resolveFormsBody,
    response: formsResolution,
  },
  createEntry: {
    method: "POST",
    path: "/api/entries",
    auth: "either",
    summary: "Create entry and optional sense cue backfills atomically",
    body: createEntryBody,
    response: entryDetail,
  },
  updateEntry: {
    method: "PATCH",
    path: "/api/entries/:id",
    auth: "either",
    summary: "Edit an entry at its revision",
    params: entryIdParams,
    body: updateEntryBody,
    response: entryDetail,
  },
  deleteEntry: {
    method: "DELETE",
    path: "/api/entries/:id",
    auth: "either",
    summary: "Delete an entry at its revision",
    params: entryIdParams,
    body: deleteEntryBody,
    response: entryDetail,
  },
  studyInventory: {
    method: "GET",
    path: "/api/study/inventory",
    auth: "either",
    summary: "Study inventory",
    response: studyInventory,
  },
  startStudy: {
    method: "POST",
    path: "/api/study/sessions",
    auth: "either",
    summary: "Start durable study session",
    body: startStudyBody,
    response: studySession,
  },
  getStudy: {
    method: "GET",
    path: "/api/study/sessions/:id",
    auth: "either",
    summary: "Read study session",
    params: studySessionParams,
    response: studySession,
  },
  answerStudy: {
    method: "POST",
    path: "/api/study/sessions/:id/answers",
    auth: "either",
    summary: "Record one study answer",
    params: studySessionParams,
    body: answerStudyBody,
    response: answerStudyResponse,
  },
  endStudy: {
    method: "POST",
    path: "/api/study/sessions/:id/end",
    auth: "either",
    summary: "End or cancel study session",
    params: studySessionParams,
    body: endStudyBody,
    response: studySession,
  },
  listStudyHistory: {
    method: "GET",
    path: "/api/study/history",
    auth: "either",
    summary: "List stored study history, newest first",
    query: studyHistoryQuery,
    response: studyHistoryPage,
  },
  getStudyHistory: {
    method: "GET",
    path: "/api/study/history/:id",
    auth: "either",
    summary: "Export one study history record as its schema-v2 JSON document",
    params: studyHistoryParams,
    response: studyHistoryRecord,
  },
  generateDraft: {
    method: "POST",
    path: "/api/ai/generate",
    auth: "either",
    summary: "Generate unsaved vocabulary drafts",
    body: generateBody,
    response: generateResponse,
    timeoutMs: 90_000,
  },
  matchMeaning: {
    method: "POST",
    path: "/api/ai/meaning-match",
    auth: "either",
    summary: "Ask AI whether a candidate meaning is one of its term's entries or a new meaning",
    body: matchMeaningBody,
    response: meaningMatch,
    timeoutMs: 90_000,
  },
  recordAiDraftEvent: {
    method: "POST",
    path: "/api/ai/draft-events",
    auth: "either",
    summary: "Record an observed AI draft presentation or explicit skip",
    body: aiDraftEventBody,
    response: aiDraftEventResponse,
  },
} as const satisfies Record<string, RouteContract>;
