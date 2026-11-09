import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../shared/app-error.js";
import { hostName } from "../../shared/host-name.js";

/** Rejects requests whose Host header is not allowed (DNS rebinding, unexpected exposure). */
export function hostGuard(allowedHosts: readonly string[]) {
  const allowed = new Set(allowedHosts);
  return (req: Request, _res: Response, next: NextFunction) => {
    const host = hostName(req.headers.host ?? "");
    if (allowed.has(host)) return next();
    next(
      new AppError("forbidden", { message: "Host not allowed", internal: "Rejected Host header" }),
    );
  };
}

/** Bounds concurrent requests before any body parsing or handler work. */
export function concurrencyLimit(max: number) {
  let active = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (active >= max) {
      res.setHeader("Retry-After", "1");
      return next(
        new AppError("unavailable", {
          message: "Server busy, retry later",
          internal: "Concurrency limit",
        }),
      );
    }
    active += 1;
    res.once("close", () => {
      active -= 1;
    });
    next();
  };
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
}
