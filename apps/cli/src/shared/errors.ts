import type { ApiError } from "@vocab/api-client";

import { errorCopy } from "./errors-copy.ts";

export type FailureKind = "network" | "auth" | "api" | "input";

/** A failure shown to the user; the current mode and command context survive it. */
export class CliError extends Error {
  override readonly name = "CliError";
  readonly kind: FailureKind;
  readonly apiError: ApiError | undefined;
  /** The attempted write is kept in the pending journal and will be retried automatically. */
  readonly journaled: boolean;

  constructor(
    message: string,
    kind: FailureKind,
    options: { apiError?: ApiError; cause?: unknown; journaled?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.apiError = options.apiError;
    this.journaled = options.journaled ?? false;
  }
}

/** Facts the CLI already knows about a request; the API keeps its diagnostics private. */
export type ErrorContext = {
  operation?:
    | "delete"
    | "edit"
    | "study"
    | "list"
    | "search"
    | "show"
    | "add"
    | "capture"
    | "captures";
  term?: string;
  id?: number;
  typeFilter?: string;
  senseCue?: string;
};

/** Stable domain reason supplied by the API. */
export function legacyCodeOf(error: ApiError): string | undefined {
  return error.reason;
}

export function pageOutOfRangeMessage(
  page: number,
  total: number,
  limit: number,
  operation: "list" | "search",
): string {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return operation === "search"
    ? errorCopy.searchPage(page, totalPages, total, limit)
    : errorCopy.listPage(page, totalPages, total, limit);
}

/** Legacy terminal wording for an API failure, using what the CLI knows about the request. */
export function describeApiError(error: ApiError, context: ErrorContext = {}): string {
  const { term, id, operation } = context;
  switch (legacyCodeOf(error)) {
    case "MISSING_WORD_INPUT":
      return errorCopy.missingWord;
    case "WORD_DUPLICATE":
      return term ? errorCopy.duplicate(term) : errorCopy.duplicateGeneric;
    case "WORD_NOT_FOUND_BY_ID":
      return id !== undefined ? errorCopy.missingId(id) : errorCopy.missingIdGeneric;
    case "WORD_AMBIGUOUS":
      return term ? errorCopy.ambiguous(term) : errorCopy.ambiguousGeneric;
    case "MISSING_SENSE_CUE":
      return term ? errorCopy.missingCue(term) : errorCopy.missingCueGeneric;
    case "INVALID_SENSE_CUE":
      return errorCopy.invalidCue;
    case "SENSE_CUE_DUPLICATE":
      return term && context.senseCue
        ? errorCopy.duplicateCue(context.senseCue, term)
        : errorCopy.duplicateCueGeneric;
    case "INVALID_RELATION_TOKEN":
      return errorCopy.invalidRelation;
    case "RELATION_TARGET_NOT_FOUND_BY_ID":
      return errorCopy.missingRelation;
    case "RELATION_TARGET_AMBIGUOUS":
      return errorCopy.ambiguousRelation;
    case "WORD_NOT_FOUND":
      return term ? errorCopy.missingTerm(term) : errorCopy.missingTermGeneric;
    case "VOCAB_EMPTY":
      if (operation === "delete") return errorCopy.emptyDelete;
      if (operation === "edit") return errorCopy.emptyEdit;
      if (operation === "study") return errorCopy.emptyStudy;
      return errorCopy.empty;
    case "NO_WORDS_FOR_FILTER":
      return context.typeFilter
        ? errorCopy.noFilter(context.typeFilter)
        : errorCopy.noFilterGeneric;
    case "NO_CHANGES":
      return errorCopy.noChanges;
    case "CURSOR_OUT_OF_RANGE":
      return errorCopy.pageRange;
    case "EMPTY_SEARCH_QUERY":
      return errorCopy.emptySearch;
    case "INVALID_ID_RANGE":
      return errorCopy.invalidRange;
    case "PERSISTENCE_WRITE_FAILED":
      return errorCopy.saveFailed;
    case "REVISION_CONFLICT":
      return errorCopy.revision(id);
  }
  if (error.reason === "ENTRY_NOT_FOUND" && id !== undefined) return errorCopy.missingId(id);
  if (error.code === "internal") return errorCopy.saveFailed;
  if (error.code === "validation_failed" && error.issues?.length)
    return errorCopy.validation(
      error.message,
      error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; "),
    );
  return error.message;
}
