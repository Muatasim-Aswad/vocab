import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const { Database } = await import(resolve(root, "apps/api/dist/infra/db/database.js"));
const migrationsFolder = resolve(root, "apps/api/drizzle");
const historyTables = ["study_history", "study_history_sources", "study_history_imports"];

export async function backup(source, destination) {
  assert.notEqual(resolve(source), resolve(destination), "Source and backup must differ");
  assert.ok(!existsSync(destination), "Backup destination already exists");
  const db = new Database({ path: source, migrationsFolder, exclusive: true });
  try {
    assert.equal(db.migrationState().status, "ok", "Source migrations differ");
    await db.sqlite.backup(destination);
  } finally {
    db.close();
  }
}

export function validate(path) {
  const db = new Database({ path, migrationsFolder, readonly: true });
  try {
    assert.equal(db.migrationState().status, "ok", "Migrations differ");
    assert.deepEqual(db.sqlite.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.sqlite.pragma("foreign_key_check"), []);
    for (const name of [
      "study_history_no_update",
      "study_history_no_delete",
      "study_history_sources_no_update",
      "study_history_sources_no_delete",
    ]) {
      assert.ok(
        db.sqlite
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name),
        `Missing ${name}`,
      );
    }
    return Object.fromEntries(
      historyTables.map((table) => {
        const digest = createHash("sha256");
        let count = 0;
        for (const row of db.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY 1`).iterate()) {
          digest.update(JSON.stringify(row)).update("\n");
          count++;
        }
        return [table, { count, sha256: digest.digest("hex") }];
      }),
    );
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "backup" && args.length === 2) await backup(...args);
    else if (command === "validate" && args.length === 1)
      console.log(JSON.stringify(validate(args[0]), null, 2));
    else if (command === "compare" && args.length === 2)
      assert.deepEqual(validate(args[0]), validate(args[1]), "History differs");
    else
      throw new Error(
        "Usage: recovery.mjs backup SOURCE NEW_BACKUP | validate COPY | compare BACKUP RESTORED_COPY",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
