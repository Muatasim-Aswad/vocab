import type { ApiErrorResponse, CommonErrorCode, ValidationIssue } from "@vocab/contracts";

/** The API answered with a contract error body. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly code: CommonErrorCode;
  readonly reason: string | undefined;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;
  readonly issues: ValidationIssue[] | undefined;

  constructor({ error }: ApiErrorResponse) {
    super(error.message);
    this.status = error.status;
    this.code = error.code;
    this.reason = error.reason;
    this.requestId = error.request_id;
    this.details = error.details;
    this.issues = error.issues;
  }
}

/** The response broke the contract: wrong status, non-JSON body, or a body failing its schema. */
export class ApiResponseError extends Error {
  override readonly name = "ApiResponseError";
  readonly status: number;
  /** From the response header, when present. */
  readonly requestId: string | undefined;

  constructor(
    message: string,
    status: number,
    requestId: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.status = status;
    this.requestId = requestId;
  }
}

/** The request never produced a response (network failure, refused connection). */
export class ApiNetworkError extends Error {
  override readonly name = "ApiNetworkError";
}
