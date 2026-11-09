import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { backup, validate } from "./recovery.mjs";

const root = resolve(import.meta.dirname, "../..");
const { Database } = await import(resolve(root, "apps/api/dist/infra/db/database.js"));

test("disposable backup and restore preserves immutable history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vocab-recovery-"));
  try {
    const source = join(dir, "source.db");
    const archive = join(dir, "backup.db");
    const restored = join(dir, "restored.db");
    const db = new Database({
      path: source,
      migrationsFolder: join(root, "apps/api/drizzle"),
      create: true,
    });
    db.migrate();
    db.sqlite
      .prepare(
        "INSERT INTO study_history (id, origin, schema_version, started_at, review_count, document_json, recorded_at) VALUES (?, 'import', 2, ?, 0, ?, ?)",
      )
      .run("synthetic", "2026-01-01", "{}", "2026-01-01");
    db.close();
    await backup(source, archive);
    copyFileSync(archive, restored);
    assert.deepEqual(validate(archive), validate(restored));
    assert.equal(validate(restored).study_history.count, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
