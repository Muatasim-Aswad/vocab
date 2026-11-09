import { ConfigError, loadStorageConfig } from "./config.js";
import { Database } from "./infra/db/database.js";
import { createLogger } from "./platform/logger.js";

/** Explicit migration step: creates the database if missing and applies pending migrations. */
const logger = createLogger();
try {
  const storage = loadStorageConfig();
  const database = new Database({ ...storage, create: true });
  try {
    const applied = database.migrate();
    logger.log({ event: "migrations_applied", database: storage.path, applied }, "Migrate");
  } finally {
    database.close();
  }
} catch (error) {
  const details =
    error instanceof ConfigError ? { issues: error.issues } : { error: String(error) };
  logger.fatal({ event: "migration_failed", ...details }, "Migrate");
  process.exitCode = 1;
}
