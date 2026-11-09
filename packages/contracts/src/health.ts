import { z } from "zod";

import { utcTimestamp } from "./primitives.ts";

export const liveness = z.object({ status: z.literal("ok") });

export type Liveness = z.infer<typeof liveness>;

/** Readiness dependency checks; public, so they carry states only, never causes. */
export const readinessChecks = z.object({
  database: z.enum(["ok", "failed"]),
  /** `pending`: not yet applied; `diverged`: applied history differs from the shipped migrations. */
  migrations: z.enum(["ok", "pending", "diverged", "unknown"]),
});

export type ReadinessChecks = z.infer<typeof readinessChecks>;

/** 200 body of the readiness route. */
export const readiness = z.object({ status: z.literal("ready"), checks: readinessChecks });

/** `details` of the readiness route's 503 `unavailable` error. */
export const readinessFailureDetails = z.object({ checks: readinessChecks });

/** Protected application status. */
export const appStatus = z.object({
  service: z.literal("vocab-api"),
  version: z.string(),
  started_at: utcTimestamp,
  server_time: utcTimestamp,
  database: z.object({ applied_migrations: z.int().nonnegative() }),
});

export type AppStatus = z.infer<typeof appStatus>;
