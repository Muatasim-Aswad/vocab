import { randomUUID } from "node:crypto";

import type { LoggerService } from "@nestjs/common";
import { requestIdHeader } from "@vocab/contracts";
import type { NextFunction, Request, Response } from "express";

/** Failure recorded by the error filter for the request's single log entry. */
export interface Failure {
  code: string;
  internal?: string;
  private?: Record<string, unknown>;
  cause?: unknown;
}

interface Locals {
  requestId?: string;
  failure?: Failure;
}

/** Accepted incoming correlation IDs; anything else is replaced. */
const requestIdPattern = /^[\w.:-]{1,128}$/;

export function requestIdOf(res: Response): string {
  return (res.locals as Locals).requestId ?? "unknown";
}

export function recordFailure(res: Response, failure: Failure): void {
  (res.locals as Locals).failure = failure;
}

/**
 * Assigns the request ID (reusing a valid incoming one), returns it in the response header,
 * and writes one structured log entry per request, including any recorded failure.
 * Logs the path only: query strings and headers can carry secrets.
 */
export function requestContext(logger: LoggerService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get(requestIdHeader);
    const requestId = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
    (res.locals as Locals).requestId = requestId;
    res.setHeader(requestIdHeader, requestId);

    const started = performance.now();
    res.once("close", () => {
      const { failure } = res.locals as Locals;
      const entry = {
        event: "http_request",
        request_id: requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - started),
        ...(!res.writableFinished && { aborted: true }),
        ...(failure && { error: failure }),
      };
      if (res.statusCode >= 500) logger.error(entry, undefined, "Http");
      else if (failure) logger.warn(entry, "Http");
      else logger.log(entry, "Http");
    });
    next();
  };
}
