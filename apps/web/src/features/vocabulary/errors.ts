import { ApiError, ApiNetworkError, ApiResponseError } from "@vocab/api-client";

/** A localized explanation of a failed request, with the field it belongs to when known. */
export interface Problem {
  key: string;
  field?: string;
  requestId?: string;
}

// Stable reasons map domain failures to localized messages.
const knownMessages: Record<string, Omit<Problem, "requestId">> = {
  MISSING_WORD_INPUT: { key: "vocab.error.termRequired", field: "term" },
  MISSING_SENSE_CUE: {
    key: "vocab.error.labelRequired",
    field: "senseCue",
  },
  INVALID_SENSE_CUE: { key: "vocab.error.labelWords", field: "senseCue" },
  SENSE_CUE_DUPLICATE: {
    key: "vocab.error.labelDuplicate",
    field: "senseCue",
  },
  INVALID_RELATION_TOKEN: { key: "vocab.error.relationInvalid", field: "relations" },
  RELATION_TARGET_NOT_FOUND_BY_ID: {
    key: "vocab.error.relationMissing",
    field: "relations",
  },
  RELATION_TARGET_AMBIGUOUS: {
    key: "vocab.error.relationAmbiguous",
    field: "relations",
  },
  WORD_NOT_FOUND_BY_ID: { key: "vocab.error.meaningsChanged", field: "meanings" },
  REVISION_CONFLICT: { key: "vocab.error.meaningsChanged", field: "meanings" },
  ENTRY_NOT_FOUND: { key: "vocab.error.meaningsChanged", field: "meanings" },
  MUTATION_IDENTITY_REUSED: { key: "vocab.error.identityReused" },
  INVALID_CURSOR: { key: "vocab.error.staleCursor" },
  AI_UNCONFIGURED: { key: "vocab.ai.error.unconfigured" },
  AI_BUSY: { key: "vocab.ai.error.busy" },
  AI_TIMEOUT: { key: "vocab.error.timeout" },
  AI_FAILED: { key: "vocab.ai.error.failed" },
};

const validationFields: Record<string, string> = {
  lemma: "term",
  senseCue: "senseCue",
  extra: "extra",
  examples: "examples",
  relatedTokens: "relations",
  senseCueBackfills: "meanings",
};

export function describeError(error: unknown): Problem {
  if (error instanceof ApiError) {
    const known = error.reason ? knownMessages[error.reason] : undefined;
    if (known) return { ...known, requestId: error.requestId };
    if (error.code === "validation_failed") {
      const path = error.issues?.[0]?.path ?? [];
      const name = path.find(
        (part): part is string => typeof part === "string" && part in validationFields,
      );
      return {
        key: "vocab.error.invalid",
        ...(name && { field: validationFields[name] }),
        requestId: error.requestId,
      };
    }
    return { key: `vocab.error.code.${error.code}`, requestId: error.requestId };
  }
  if (error instanceof ApiNetworkError) return { key: "vocab.error.network" };
  if (error instanceof ApiResponseError)
    return {
      key: "vocab.error.unexpected",
      ...(error.requestId && { requestId: error.requestId }),
    };
  if (error instanceof DOMException && error.name === "TimeoutError")
    return { key: "vocab.error.timeout" };
  return { key: "vocab.error.unexpected" };
}

const captureRejections = new Set(["CAPTURE_NOT_FOUND", "CAPTURE_MISMATCH"]);

/** The API refused only the capture an entry write would consume; nothing was written. */
export function isCaptureRejection(error: unknown): boolean {
  return (
    error instanceof ApiError && error.reason !== undefined && captureRejections.has(error.reason)
  );
}

/**
 * Whether a failed write may still have committed. Only a contract error below 500 proves the
 * API rejected it; anything else keeps the mutation identity for reconciliation.
 */
export function mayHaveCommitted(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}
