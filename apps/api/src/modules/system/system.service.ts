import { Inject, Injectable } from "@nestjs/common";
import type { AppStatus, ReadinessChecks } from "@vocab/contracts";

import { Database } from "../../infra/db/database.js";
import { AppError } from "../../shared/app-error.js";
import { SYSTEM_OPTIONS, type SystemOptions } from "./system.options.js";

@Injectable()
export class SystemService {
  private readonly startedAt = new Date();

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(SYSTEM_OPTIONS) private readonly options: SystemOptions,
  ) {}

  /** Ready when the database answers and every shipped migration is applied unchanged. */
  readiness(): { status: "ready"; checks: ReadinessChecks } {
    const database = this.database.ping() ? "ok" : "failed";
    const migrations = database === "ok" ? this.database.migrationState().status : "unknown";
    const checks: ReadinessChecks = { database, migrations };
    if (database === "ok" && migrations === "ok") return { status: "ready", checks };
    throw new AppError("unavailable", {
      message: "Not ready",
      internal: "Readiness check failed",
      details: { public: { checks } },
    });
  }

  status(now = new Date()): AppStatus {
    return {
      service: "vocab-api",
      version: this.options.version,
      started_at: this.startedAt.toISOString(),
      server_time: now.toISOString(),
      database: { applied_migrations: this.database.migrationState().applied },
    };
  }
}
