import { z } from "zod";

/** Codes every HTTP app can return. Apps extend this with feature codes. */
export const commonErrorCode = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "internal",
  "unavailable",
]);

export const errorReason = z.enum([
  "MISSING_WORD_INPUT",
  "WORD_DUPLICATE",
  "WORD_NOT_FOUND",
  "WORD_NOT_FOUND_BY_ID",
  "WORD_AMBIGUOUS",
  "MISSING_SENSE_CUE",
  "INVALID_SENSE_CUE",
  "SENSE_CUE_DUPLICATE",
  "INVALID_RELATION_TOKEN",
  "RELATION_TARGET_NOT_FOUND_BY_ID",
  "RELATION_TARGET_AMBIGUOUS",
  "VOCAB_EMPTY",
  "NO_WORDS_FOR_FILTER",
  "NO_CHANGES",
  "CURSOR_OUT_OF_RANGE",
  "EMPTY_SEARCH_QUERY",
  "INVALID_REGEX",
  "INVALID_ID_RANGE",
  "PERSISTENCE_WRITE_FAILED",
  "REVISION_CONFLICT",
  "STUDY_REVISION_CONFLICT",
  "ENTRY_NOT_FOUND",
  "CAPTURE_NOT_FOUND",
  "CAPTURE_MISMATCH",
  "MUTATION_IDENTITY_REUSED",
  "INVALID_CURSOR",
  "AI_UNCONFIGURED",
  "AI_BUSY",
  "AI_TIMEOUT",
  "AI_FAILED",
]);

export type ErrorReason = z.infer<typeof errorReason>;

export type CommonErrorCode = z.infer<typeof commonErrorCode>;

export const validationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string().optional(),
});

export type ValidationIssue = z.infer<typeof validationIssue>;

/** HTTP error body, parameterized by the app's `Code` and `PublicDetails` schemas. */
export const errorResponse = <Code extends z.ZodType, Details extends z.ZodType>(
  code: Code,
  details: Details,
) =>
  z.object({
    error: z.object({
      status: z.int().min(400).max(599),
      code,
      message: z.string(),
      reason: z.string().optional(),
      request_id: z.string(),
      details: details.optional(),
      issues: z.array(validationIssue).optional(),
    }),
  });

/** Public error details: caller-safe data only. */
export const errorDetails = z.record(z.string(), z.unknown());

/** The API's HTTP error body. */
export const apiErrorResponse = errorResponse(commonErrorCode, errorDetails);

export type ApiErrorResponse = z.infer<typeof apiErrorResponse>;
