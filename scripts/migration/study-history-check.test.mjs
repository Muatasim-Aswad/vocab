import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { compareHistory, tableDigests } from "./study-history-check.mjs";

const root = resolve(import.meta.dirname, "../..");
const apiDist = join(root, "apps/api/dist");
const migrations = join(root, "apps/api/drizzle");

/** A pre-history-table database with ended sessions and the JSON logs that server wrote. */
async function postCutoverDatabase(directory) {
  const { Database } = await import(join(apiDist, "infra/db/database.js"));
  const oldMigrations = join(directory, "pre-d1-drizzle");
  const [first] = readdirSync(migrations).toSorted();
  cpSync(join(migrations, first), join(oldMigrations, first), { recursive: true });
  const path = join(directory, "vocab.sqlite");
  const database = new Database({ path, migrationsFolder: oldMigrations, create: true });
  database.migrate();
  const logs = join(directory, "logs");
  mkdirSync(logs);
  const insert = database.sqlite.prepare(
    "INSERT INTO study_sessions (id, state_json, revision, started_at, updated_at, ended_at) VALUES (?, ?, 3, ?, ?, ?)",
  );
  for (const [index, outcome] of ["completed", "quit"].entries()) {
    const id = `0199b5aa-1d0c-7000-8000-00000000000${index}`;
    const startedAt = `2026-09-28T1${index}:00:00.000Z`;
    const endedAt = `2026-09-28T1${index}:05:00.000Z`;
    const state = {
      sessionWords: [{ id: 7, lemma: "huis", priority: 0.5 }],
      selection: { type: "top", maxWords: 1 },
      nextIndex: 1,
      stats: {
        totalWords: 1,
        wordsReviewed: 1,
        veryKnowCount: 0,
        knowCount: 1,
        clueCount: 0,
        cluesCount: 0,
        noCount: 0,
      },
      reviews: [{ id: 7, term: "huis", priority: 0.5, reviewedAt: startedAt }],
    };
    insert.run(id, JSON.stringify(state), startedAt, endedAt, endedAt);
    const log = {
      schemaVersion: 2,
      sessionId: id,
      startedAt,
      endedAt,
      selection: state.selection,
      sortResult: [{ id: 7, term: "huis", priority: 0.5 }],
      reviews: state.reviews,
      stats: state.stats,
      outcome: { status: outcome },
    };
    writeFileSync(
      join(logs, `study-session-${index}-${id}.json`),
      JSON.stringify(log, null, 2) + "\n",
    );
  }
  database.close();
  return { path, logs };
}

const node = (script, args, env = {}) =>
  spawnSync(process.execPath, [join(apiDist, script), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });

void test("runbook check: migrate, import and verify a post-cutover copy without touching other data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vocab-history-runbook-"));
  try {
    const { path, logs } = await postCutoverDatabase(directory);
    const before = tableDigests(path);
    assert.equal(node("migrate.js", [], { VOCAB_DATABASE_PATH: path }).status, 0);
    const dryRun = node("import-study-history.js", [
      "--database",
      path,
      "--logs",
      logs,
      "--dry-run",
      "true",
    ]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const { sourceFingerprint, totals } = JSON.parse(dryRun.stdout);
    assert.equal(totals.linkedSessions, 2);
    const applied = node("import-study-history.js", [
      "--database",
      path,
      "--logs",
      logs,
      "--expect",
      sourceFingerprint,
    ]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(compareHistory(path, [logs]), {
      files: 2,
      logRecords: 2,
      records: 2,
      imported: 2,
      sources: 2,
      sessionsWithoutHistory: [],
    });
    assert.deepEqual(tableDigests(path), before);

    // A log that no longer matches its stored record fails the comparison.
    const [name] = readdirSync(logs);
    writeFileSync(join(logs, name), JSON.stringify({ schemaVersion: 2, sessionId: randomUUID() }));
    assert.throws(() => compareHistory(path, [logs]), /No history record/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
