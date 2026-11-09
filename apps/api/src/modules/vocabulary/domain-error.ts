import type { ErrorReason } from "@vocab/contracts";

import { AppError as BaseAppError, type ErrorCode } from "../../shared/app-error.js";

const descriptions = {
  MISSING_WORD_INPUT: "Word input was empty or missing.",
  WORD_DUPLICATE: "Word already exists.",
  WORD_NOT_FOUND: "Word does not exist.",
  WORD_NOT_FOUND_BY_ID: "Word id does not exist.",
  WORD_AMBIGUOUS: "Multiple entries match the same term.",
  MISSING_SENSE_CUE: "Sense cue is required for another entry with this term.",
  INVALID_SENSE_CUE: "Sense cue must be one or two words.",
  SENSE_CUE_DUPLICATE: "Sense cue already exists for this term.",
  INVALID_RELATION_TOKEN: "Relation token is invalid.",
  RELATION_TARGET_NOT_FOUND_BY_ID: "Relation target id does not exist.",
  RELATION_TARGET_AMBIGUOUS: "Relation target term matches multiple entries.",
  VOCAB_EMPTY: "Vocabulary has no entries.",
  NO_WORDS_FOR_FILTER: "No entries match the requested filter.",
  NO_CHANGES: "Edit payload has no effective changes.",
  CURSOR_OUT_OF_RANGE: "Requested page is outside available range.",
  EMPTY_SEARCH_QUERY: "Search query is empty.",
  INVALID_REGEX: "Regex query is invalid.",
  INVALID_ID_RANGE: "Study range is invalid.",
  PERSISTENCE_WRITE_FAILED: "Persisting data failed.",
  REVISION_CONFLICT: "Entry changed since it was read.",
} satisfies Partial<Record<ErrorReason, string>>;

type VocabularyReason = keyof typeof descriptions;

function publicCode(legacyCode: string): ErrorCode {
  if (legacyCode === "PERSISTENCE_WRITE_FAILED") return "internal";
  if (
    legacyCode.includes("NOT_FOUND") ||
    legacyCode === "VOCAB_EMPTY" ||
    legacyCode === "NO_WORDS_FOR_FILTER"
  )
    return "not_found";
  if (
    legacyCode.includes("DUPLICATE") ||
    legacyCode.includes("AMBIGUOUS") ||
    legacyCode === "REVISION_CONFLICT"
  )
    return "conflict";
  return "bad_request";
}

/** Retains legacy distinctions inside the feature while the HTTP boundary uses common codes. */
export class AppError extends BaseAppError {
  readonly legacyCode: string;
  readonly context: Record<string, unknown>;

  constructor(
    legacyCode: VocabularyReason,
    options: {
      message?: string;
      clientMessage?: string;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(publicCode(legacyCode), {
      reason: legacyCode,
      message: options.clientMessage ?? descriptions[legacyCode] ?? "Vocabulary operation failed",
      internal: options.message ?? legacyCode,
      details: {
        ...(legacyCode === "REVISION_CONFLICT" &&
          typeof options.context?.currentRevision === "number" && {
            public: { currentRevision: options.context.currentRevision },
          }),
        private: options.context ?? {},
      },
      cause: options.cause,
    });
    this.legacyCode = legacyCode;
    this.context = options.context ?? {};
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
