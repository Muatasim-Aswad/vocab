import { resolve } from "node:path";

import { Database } from "./infra/db/database.js";
import {
  createStudyHistoryImporter,
  readStudyHistorySource,
  StudyHistoryImportError,
} from "./modules/study/study-history-import.service.js";

const usage =
  "Usage: import-study-history --database FILE --logs DIR (--dry-run true | --expect SHA256)";

function flags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--") || name in result)
      throw new Error(usage);
    result[name] = value;
  }
  return result;
}

/**
 * Explicit offline import of JSON study logs into an existing, migrated database. A dry run
 * opens the database read-only; an apply needs the source fingerprint and exclusive access.
 */
try {
  const args = flags(process.argv.slice(2));
  const databasePath = args["--database"];
  const logsPath = args["--logs"];
  const dryRun = args["--dry-run"] === "true";
  const expected = args["--expect"];
  if (!databasePath || !logsPath || dryRun === Boolean(expected)) throw new Error(usage);
  if (expected && !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Expected source SHA-256 is required");
  const database = new Database({
    path: resolve(databasePath),
    migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
    readonly: dryRun,
    exclusive: !dryRun,
  });
  try {
    const migrations = database.migrationState();
    const importer = createStudyHistoryImporter(database);
    const source = readStudyHistorySource(logsPath);
    if (dryRun) {
      const report = importer.inventory(source, "server-logs");
      process.stdout.write(
        JSON.stringify({ mode: "dry-run", migrations: migrations.status, ...report }) + "\n",
      );
      if (!report.ok) process.exitCode = 1;
    } else {
      if (migrations.status !== "ok")
        throw new Error("Target database migrations are not applied; run db:migrate first");
      const report = importer.apply(source, {
        kind: "server-logs",
        expectedFingerprint: expected!,
        importedAt: new Date().toISOString(),
      });
      process.stdout.write(JSON.stringify({ mode: "apply", ...report }) + "\n");
    }
  } finally {
    database.close();
  }
} catch (error) {
  if (error instanceof StudyHistoryImportError && error.report)
    process.stdout.write(JSON.stringify({ mode: "refused", ...error.report }) + "\n");
  process.stderr.write((error instanceof Error ? error.message : "Import failed") + "\n");
  process.exitCode = 1;
}
