import { inspect } from "node:util";

import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ApiErrorResponse } from "@vocab/contracts";
import type { Response } from "express";

import { AppError, ValidationError, type ErrorCode } from "../../shared/app-error.js";
import { recordFailure, requestIdOf } from "./request-context.js";

const statusByCode: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

const codeByStatus = new Map<number, ErrorCode>([
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not_found"],
  [409, "conflict"],
  [413, "payload_too_large"],
  [429, "rate_limited"],
  [503, "unavailable"],
]);

/** Express/body-parser errors carry an HTTP status (http-errors). */
function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  if (error instanceof Error && "status" in error && typeof error.status === "number")
    return error.status;
  return undefined;
}

/** Framework messages can echo URLs; query strings may carry secrets. */
const withoutQuery = (message: string) => message.replaceAll(/\?\S*/g, "");

/** Maps anything thrown to an AppError. Framework messages go to `internal`: they can echo input. */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = httpStatusOf(error);
  if (status !== undefined && status >= 400 && status < 500) {
    const code = codeByStatus.get(status) ?? "bad_request";
    return new AppError(code, {
      internal: error instanceof Error ? withoutQuery(error.message) : undefined,
      cause: error,
    });
  }
  return new AppError("internal", { internal: "Unhandled exception", cause: error });
}

/** Log-safe cause chain: JSON drops Error fields. */
function describe(cause: unknown, depth = 0): unknown {
  if (!(cause instanceof Error))
    return cause === undefined ? undefined : inspect(cause, { depth: 2 });
  return {
    name: cause.name,
    message: cause.message,
    stack: cause.stack,
    ...(depth < 3 && cause.cause !== undefined && { cause: describe(cause.cause, depth + 1) }),
  };
}

/**
 * Final HTTP error mapping for application, validation, routing, and unexpected failures.
 * Sends the contract error body; hands private data to the request log entry only.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const error = toAppError(exception);
    const status = statusByCode[error.code];
    const requestId = requestIdOf(res);

    recordFailure(res, {
      code: error.code,
      ...(error.internal !== undefined && { internal: error.internal }),
      ...(error.details?.private && { private: error.details.private }),
      ...(status >= 500 && { cause: describe(error.cause ?? error) }),
    });
    if (res.headersSent) {
      res.end();
      return;
    }

    const body: ApiErrorResponse = {
      error: {
        status,
        code: error.code,
        message: error.message,
        ...(error.reason && { reason: error.reason }),
        request_id: requestId,
        ...(error.details?.public && { details: error.details.public }),
        ...(error instanceof ValidationError && { issues: error.issues }),
      },
    };
    if (error.code === "unauthorized") res.setHeader("WWW-Authenticate", "Bearer");
    res.status(status).json(body);
  }
}
