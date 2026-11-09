import type { CommonErrorCode, ErrorReason, ValidationIssue } from "@vocab/contracts";

export type ErrorCode = CommonErrorCode;

/** Safe for the caller. */
type PublicDetails = Record<string, unknown>;

/** Stays inside the app (logs only). */
type PrivateDetails = Record<string, unknown>;

export interface AppErrorOptions {
  /** Caller-safe message; defaults to a generic one for the code. */
  message?: string;
  reason?: ErrorReason;
  /** Operator-facing explanation; never sent to callers. */
  internal?: string;
  cause?: unknown;
  details?: { public?: PublicDetails; private?: PrivateDetails };
}

const defaultMessages: Record<ErrorCode, string> = {
  bad_request: "Malformed request",
  validation_failed: "Request validation failed",
  unauthorized: "Authentication required",
  forbidden: "Access denied",
  not_found: "Not found",
  conflict: "Conflict with the current state",
  payload_too_large: "Request body too large",
  rate_limited: "Too many requests",
  internal: "Internal server error",
  unavailable: "Service unavailable",
};

/**
 * Transport-independent application error. `message` and `details.public` are caller-safe;
 * `internal`, `details.private`, and `cause` stay inside the app. Never serialize it directly.
 */
export class AppError extends Error {
  override readonly name: string = "AppError";
  readonly code: ErrorCode;
  readonly reason: ErrorReason | undefined;
  readonly internal: string | undefined;
  readonly details: AppErrorOptions["details"];

  constructor(
    code: ErrorCode,
    { message, reason, internal, cause, details }: AppErrorOptions = {},
  ) {
    super(message ?? defaultMessages[code], { cause });
    this.code = code;
    this.reason = reason;
    this.internal = internal;
    this.details = details;
  }

  /** Blocks accidental serialization of private fields. */
  toJSON() {
    return { name: this.name, code: this.code };
  }
}

/** Input failed validation; `issues` are caller-safe. */
export class ValidationError extends AppError {
  override readonly name = "ValidationError";
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], options: Omit<AppErrorOptions, "details"> = {}) {
    super("validation_failed", options);
    this.issues = issues;
  }
}
