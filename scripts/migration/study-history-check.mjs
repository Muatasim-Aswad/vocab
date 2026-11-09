import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only checks for the study-history conversion runbook. Never writes the database or logs.
const root = resolve(import.meta.dirname, "../..");
const Database = createRequire(join(root, "apps/api/package.json"))("better-sqlite3");

/** Tables the conversion must leave unchanged (everything except study history). */
export const preservedTables = [
  "entries",
  "entry_aliases",
  "entry_relations",
  "entry_id_allocator",
  "study_memory",
  "study_sessions",
  "auth_sessions",
  "mutation_receipts",
  "legacy_import_receipt",
];

function open(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

/** Per-table row count and SHA-256 over every column, in primary-key order. */
export function tableDigests(path) {
  const db = open(path);
  try {
    return Object.fromEntries(
      preservedTables.map((table) => {
        const digest = createHash("sha256");
        let count = 0;
        for (const row of db.prepare(`SELECT * FROM "${table}" ORDER BY 1, 2`).iterate()) {
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

const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .toSorted()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

function logFiles(directory, prefix = "") {
  return readdirSync(directory)
    .toSorted()
    .flatMap((name) => {
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.ok(!stat.isSymbolicLink(), `Symlink in logs: ${join(prefix, name)}`);
      return stat.isDirectory() ? logFiles(path, join(prefix, name)) : [[join(prefix, name), path]];
    });
}

/**
 * Every JSON log in `logDirs` is stored byte for byte and its document equals the stored record;
 * reports ended sessions that have no record.
 */
export function compareHistory(path, logDirs) {
  const db = open(path);
  try {
    const record = db.prepare("SELECT document_json AS json FROM study_history WHERE id = ?");
    const source = db.prepare(
      "SELECT history_id AS id FROM study_history_sources WHERE sha256 = ?",
    );
    let files = 0;
    const ids = new Set();
    for (const directory of logDirs)
      for (const [name, file] of logFiles(directory)) {
        const bytes = readFileSync(file);
        const document = JSON.parse(bytes.toString("utf8"));
        const stored = record.get(document.sessionId);
        assert.ok(stored, `No history record for ${name}`);
        assert.equal(canonical(JSON.parse(stored.json)), canonical(document), `${name} differs`);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        assert.equal(source.get(sha256)?.id, document.sessionId, `${name} bytes are not stored`);
        ids.add(document.sessionId);
        files++;
      }
    const totals = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM study_history) AS records, (SELECT COUNT(*) FROM study_history WHERE origin = 'import') AS imported, (SELECT COUNT(*) FROM study_history_sources) AS sources",
      )
      .get();
    const sessionsWithoutHistory = db
      .prepare(
        "SELECT s.id FROM study_sessions s LEFT JOIN study_history h ON h.session_id = s.id WHERE s.ended_at IS NOT NULL AND h.id IS NULL ORDER BY s.id",
      )
      .all()
      .map((row) => row.id);
    return { files, logRecords: ids.size, ...totals, sessionsWithoutHistory };
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const database = args[args.indexOf("--database") + 1];
    assert.ok(args.includes("--database") && database, "Missing --database");
    if (command === "digest") console.log(JSON.stringify(tableDigests(database)));
    else if (command === "compare") {
      const logs = args.flatMap((arg, index) => (args[index - 1] === "--logs" ? [arg] : []));
      assert.ok(logs.length, "Missing --logs");
      console.log(JSON.stringify(compareHistory(database, logs)));
    } else
      throw new Error(
        "Usage: study-history-check.mjs digest --database FILE | compare --database FILE --logs DIR [--logs DIR]",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Check failed");
    process.exitCode = 1;
  }
}
