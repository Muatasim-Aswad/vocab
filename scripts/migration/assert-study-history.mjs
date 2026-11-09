import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The server keeps study history in SQLite only. Normal operation has no study-log directory
// or setting, and study code never writes files; only the explicit importer reads JSON.
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const retiredSetting = /STUDY_LOGS_PATH|studyLogsPath|session-log\.js/;
for (const path of [...sources("apps/api/src"), ".env.example", "compose.yaml", "Dockerfile"])
  assert.doesNotMatch(
    readFileSync(path, "utf8"),
    retiredSetting,
    `retired study-log setting in ${path}`,
  );

assert.ok(!existsSync("apps/api/src/modules/study/session-log.ts"), "file logger still exists");
const fileWrites =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rename|renameSync|createWriteStream|cpSync|copyFile)\b/;
for (const path of sources("apps/api/src/modules/study"))
  assert.doesNotMatch(readFileSync(path, "utf8"), fileWrites, `study code writes files: ${path}`);

const importer = readFileSync("apps/api/src/import-study-history.ts", "utf8");
assert.match(importer, /readonly: dryRun/, "dry run must open the database read-only");
assert.match(importer, /exclusive: !dryRun/, "apply must hold exclusive database access");
assert.ok(
  JSON.parse(readFileSync("apps/api/package.json", "utf8")).scripts["db:import:study-history"],
  "missing db:import:study-history script",
);
const migrations = readdirSync("apps/api/drizzle").toSorted();
assert.ok(
  migrations.some((name) => name.endsWith("_study_history")),
  "missing study history migration",
);
console.log(
  `Database-only study history: no study-log setting or study file writes; ${migrations.length} migrations`,
);
