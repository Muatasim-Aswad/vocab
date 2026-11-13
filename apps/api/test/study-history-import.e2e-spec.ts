import { createHash } from "node:crypto";
import fs, {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";

import { routes } from "@vocab/contracts";
import BetterSqlite3 from "better-sqlite3";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Database } from "../src/infra/db/database.js";
import {
  createStudyHistoryImporter,
  readStudyHistorySource,
  StudyHistoryImportError,
  type StudyHistoryImportReport,
} from "../src/modules/study/study-history-import.service.js";
import { sessionHistoryDocument } from "../src/modules/study/study-history.js";
import {
  StudySessionRepository,
  type StudySessionState,
} from "../src/modules/study/study-session.repository.js";
import { createLegacyLogs, legacyLog, legacyLogText, legacySessionId } from "./fixtures/legacy.js";
import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

const migrationsFolder = resolve(import.meta.dirname, "../drizzle");
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup.splice(0).toReversed()) step();
});

function workspace() {
  const dir = tempDir();
  cleanup.push(dir.cleanup);
  const logs = join(dir.dir, "logs");
  mkdirSync(logs);
  return { dir: dir.dir, logs };
}

const byText = (left: string, right: string) => left.localeCompare(right);
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const tree = (dir: string) =>
  Object.fromEntries(readdirSync(dir).map((name) => [name, sha(join(dir, name))]));

function database(path: string, options: { readonly?: boolean; folder?: string } = {}) {
  const opened = new Database({
    path,
    migrationsFolder: options.folder ?? migrationsFolder,
    readonly: options.readonly,
  });
  cleanup.push(() => opened.close());
  return opened;
}

const counts = (db: Database) =>
  db.sqlite
    .prepare<[], { history: number; sources: number; imports: number }>(
      "SELECT (SELECT COUNT(*) FROM study_history) AS history, (SELECT COUNT(*) FROM study_history_sources) AS sources, (SELECT COUNT(*) FROM study_history_imports) AS imports",
    )
    .get()!;

function apply(db: Database, logs: string, expected?: string) {
  const source = readStudyHistorySource(logs);
  return createStudyHistoryImporter(db).apply(source, {
    kind: "server-logs",
    expectedFingerprint: expected ?? source.fingerprint,
    importedAt: "2026-09-28T12:00:00.000Z",
  });
}

function refusal(operation: () => unknown): StudyHistoryImportError {
  try {
    operation();
  } catch (error) {
    if (error instanceof StudyHistoryImportError) return error;
    throw error;
  }
  throw new Error("Expected the import to be refused");
}

/** A migrated disposable server database. */
function serverDatabase(dir: string) {
  const config = testConfig(dir);
  return { config, db: database(config.database.path) };
}

function sessionState(ids: number[], answered: number): StudySessionState {
  const words = ids.map((id, index) => ({
    id,
    lemma: `woord${id}`,
    language: "nl",
    revision: 1,
    priority: 1 - index / 10,
    memory: { strength: 1, difficulty: 2, streak: 0, lastReviewed: "2026-09-28T09:00:00.000Z" },
    meta: { addedAt: "2026-09-27T00:00:00.000Z", modifiedAt: "2026-09-27T00:00:00.000Z" },
  }));
  return {
    sessionWords: words,
    selection: { type: "top", maxWords: ids.length },
    nextIndex: answered,
    stats: {
      totalWords: ids.length,
      wordsReviewed: answered,
      veryKnowCount: 0,
      knowCount: answered,
      clueCount: 0,
      cluesCount: 0,
      noCount: 0,
    },
    reviews: ids.slice(0, answered).map((id) => ({
      id,
      term: `woord${id}`,
      priority: 1,
      reviewedAt: "2026-09-28T10:00:05.000Z",
      before: { strength: 1, difficulty: 2, streak: 0, lastReviewed: "2026-09-28T09:00:00.000Z" },
      after: { strength: 1.5, difficulty: 1.9, streak: 1 },
      internals: { answerScore: 1, answerTime: 1000, speedScore: 0.5 },
    })),
    weakEntryIds: [],
  };
}

describe("explicit study history import", () => {
  it("compatibility: history-import:dry-run — a dry run is read-only and reports every input", () => {
    const w = workspace();
    const { config } = serverDatabase(w.dir);
    createLegacyLogs(join(w.logs, "a.json"));
    createLegacyLogs(
      join(w.logs, "b.json"),
      legacyLog({ sessionId: "18eae214601-1", outcome: undefined }),
    );
    writeFileSync(join(w.logs, "c.json"), "{ not json");
    writeFileSync(join(w.logs, "notes.txt"), "not a log");
    const dbBefore = sha(config.database.path);
    const logsBefore = tree(w.logs);
    const db = database(config.database.path, { readonly: true });
    const report = createStudyHistoryImporter(db).inventory(
      readStudyHistorySource(w.logs),
      "server-logs",
    );
    expect(report.ok).toBe(false);
    expect(report.inputs.map((input) => [input.name, input.status])).toEqual([
      ["a.json", "import"],
      ["b.json", "import"],
      ["c.json", "invalid"],
    ]);
    expect(report.unsupported).toEqual([{ name: "notes.txt", problem: "not a .json study log" }]);
    expect(report.totals).toMatchObject({
      inputs: 3,
      imported: 2,
      invalid: 1,
      unsupported: 1,
      missingOutcome: 1,
    });
    expect(() => db.sqlite.prepare("DELETE FROM study_sessions").run()).toThrow();
    db.close();
    expect(sha(config.database.path)).toBe(dbBefore);
    expect(tree(w.logs)).toEqual(logsBefore);
  });

  it("compatibility: history-import:guards — apply requires the source fingerprint and stopped writers", () => {
    const w = workspace();
    const { config, db } = serverDatabase(w.dir);
    createLegacyLogs(join(w.logs, "session.json"));
    expect(() => apply(db, w.logs, "0".repeat(64))).toThrow(/fingerprint differs/);
    expect(counts(db)).toEqual({ history: 0, sources: 0, imports: 0 });
    // A running API keeps its connection open; the exclusive import connection is refused.
    expect(() => new Database({ ...config.database, exclusive: true })).toThrow(
      /stop the API and other writers/,
    );
    db.close();
    const offline = new Database({ ...config.database, exclusive: true });
    cleanup.push(() => offline.close());
    const late = new BetterSqlite3(config.database.path, { timeout: 100 });
    cleanup.push(() => late.close());
    expect(() => late.prepare("SELECT 1").get()).toThrow(/locked/);
    expect(apply(offline, w.logs).totals.imported).toBe(1);
  });

  it("compatibility: history-import:lossless — repeatable import keeps unknown fields, missing and error outcomes, partial sessions and deleted references", () => {
    const w = workspace();
    const { db } = serverDatabase(w.dir);
    const complete = legacyLog({ legacyExtra: { nested: [1, "two"] } });
    const partial = legacyLog({
      sessionId: "18eae214601-2",
      reviews: [],
      stats: undefined,
      endedAt: undefined,
      outcome: undefined,
    });
    const error = legacyLog({
      sessionId: "18eae214601-3",
      outcome: { status: "error", message: "persist failed", code: "E_LEGACY" },
    });
    createLegacyLogs(join(w.logs, "complete.json"), complete);
    createLegacyLogs(join(w.logs, "partial.json"), partial);
    createLegacyLogs(join(w.logs, "error.json"), error);
    // An identical copy under a second name is deduplicated, not a second record.
    writeFileSync(join(w.logs, "complete-copy.json"), JSON.stringify(complete));
    const before = tree(w.logs);
    const first = apply(db, w.logs);
    expect(first.totals).toMatchObject({
      inputs: 4,
      imported: 3,
      deduplicated: 1,
      missingOutcome: 1,
      conflicts: 0,
    });
    expect(counts(db)).toEqual({ history: 3, sources: 4, imports: 1 });
    const stored = db.sqlite
      .prepare<[], { name: string; content: Buffer }>(
        "SELECT source_name AS name, content FROM study_history_sources ORDER BY source_name",
      )
      .all();
    for (const row of stored) expect(row.content).toEqual(readFileSync(join(w.logs, row.name)));
    const documents = Object.fromEntries(
      db.sqlite
        .prepare<[], { id: string; outcome: string | null; endedAt: string | null; json: string }>(
          "SELECT id, outcome, ended_at AS endedAt, document_json AS json FROM study_history",
        )
        .all()
        .map((row) => [row.id, row]),
    );
    expect(JSON.parse(documents[String(complete.sessionId)]!.json)).toEqual(complete);
    expect(documents["18eae214601-2"]).toMatchObject({ outcome: null, endedAt: null });
    expect(JSON.parse(documents["18eae214601-2"]!.json)).toEqual(
      JSON.parse(JSON.stringify(partial)),
    );
    expect(JSON.parse(documents["18eae214601-3"]!.json).outcome).toEqual(error.outcome);

    const retry = apply(db, w.logs);
    expect(retry.totals).toMatchObject({ alreadyImported: 4, imported: 0, deduplicated: 0 });
    expect(counts(db)).toEqual({ history: 3, sources: 4, imports: 1 });
    // The same record in different bytes is deduplicated and its bytes preserved.
    writeFileSync(join(w.logs, "complete-reformatted.json"), JSON.stringify(complete, null, 4));
    expect(apply(db, w.logs).totals).toMatchObject({ deduplicated: 1, alreadyImported: 4 });
    expect(counts(db)).toEqual({ history: 3, sources: 5, imports: 2 });
    const { "complete-reformatted.json": _added, ...unchanged } = tree(w.logs);
    expect(unchanged).toEqual(before);
  });

  it("compatibility: history-import:refusals — divergent, malformed and unsupported inputs fail without partial import", () => {
    const w = workspace();
    const { db } = serverDatabase(w.dir);
    createLegacyLogs(join(w.logs, "a.json"));
    apply(db, w.logs);
    const baseline = counts(db);
    const cases: Array<[string, string, RegExp]> = [
      [
        "divergent.json",
        legacyLogText(legacyLog({ endedAt: "2024-04-05T12:00:09.000Z" })),
        /stored history record/,
      ],
      ["malformed.json", "{", /not valid JSON/],
      ["v1.json", legacyLogText(legacyLog({ schemaVersion: 1 })), /unsupported schemaVersion/],
      ["no-id.json", legacyLogText(legacyLog({ sessionId: undefined })), /sessionId/],
      [
        "bad-time.json",
        legacyLogText(legacyLog({ sessionId: "18eae214601-9", startedAt: "yesterday" })),
        /startedAt/,
      ],
      [
        "bad-outcome.json",
        legacyLogText(legacyLog({ sessionId: "18eae214601-8", outcome: { status: "paused" } })),
        /outcome/,
      ],
    ];
    for (const [name, text, problem] of cases) {
      const dir = join(w.dir, `case-${name}`);
      mkdirSync(dir);
      createLegacyLogs(join(dir, "valid-new.json"), legacyLog({ sessionId: "18eae214602-1" }));
      writeFileSync(join(dir, name), text);
      const error = refusal(() => apply(db, dir));
      const input = error.report!.inputs.find((item) => item.name === name)!;
      expect(input.status === "invalid" || input.status === "conflict").toBe(true);
      expect(input.problem).toMatch(problem);
      expect(error.report!.inputs.find((item) => item.name === "valid-new.json")!.status).toBe(
        "import",
      );
      expect(counts(db)).toEqual(baseline);
    }

    // Two files claiming one identity with different content are both refused.
    const pair = join(w.dir, "pair");
    mkdirSync(pair);
    createLegacyLogs(join(pair, "one.json"), legacyLog({ sessionId: "18eae214603-1" }));
    createLegacyLogs(
      join(pair, "two.json"),
      legacyLog({ sessionId: "18eae214603-1", outcome: { status: "completed" } }),
    );
    const pairError = refusal(() => apply(db, pair));
    expect(pairError.report!.inputs.map((input) => input.status)).toEqual(["conflict", "conflict"]);
    expect(counts(db)).toEqual(baseline);
  });

  it("refuses a regular study log swapped for a symlink before reading", () => {
    const w = workspace();
    const victim = join(w.logs, "race.json");
    const outside = join(w.dir, "outside.json");
    createLegacyLogs(victim);
    createLegacyLogs(outside, legacyLog({ sessionId: "18eae214604-9" }));
    const original = fs.lstatSync;
    let swapped = false;
    const stat = vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
      const result = original(path, options);
      if (path === victim && !swapped) {
        swapped = true;
        renameSync(victim, join(w.logs, "original.json"));
        symlinkSync(outside, victim);
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      expect(() => readStudyHistorySource(w.logs)).toThrow(/changed|outside|symlink/i);
      expect(swapped).toBe(true);
    } finally {
      stat.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it("compatibility: history-import:paths — symlinks, escapes and changing sources are refused", () => {
    const w = workspace();
    const { db } = serverDatabase(w.dir);
    const outside = join(w.dir, "outside.json");
    createLegacyLogs(outside);
    createLegacyLogs(join(w.logs, "inside.json"), legacyLog({ sessionId: "18eae214604-1" }));
    symlinkSync(outside, join(w.logs, "linked.json"));
    const linked = refusal(() => apply(db, w.logs));
    expect(linked.report!.unsupported).toEqual([{ name: "linked.json", problem: "symlink" }]);
    symlinkSync(w.dir, join(w.dir, "root-link"));
    expect(() => readStudyHistorySource(join(w.dir, "root-link"))).toThrow(/symlink/);
    expect(() => readStudyHistorySource(join(w.dir, "missing"))).toThrow(/does not exist/);
    expect(counts(db)).toEqual({ history: 0, sources: 0, imports: 0 });

    const changing = join(w.dir, "changing");
    mkdirSync(changing);
    createLegacyLogs(join(changing, "one.json"), legacyLog({ sessionId: "18eae214604-2" }));
    const source = readStudyHistorySource(changing);
    expect(() =>
      createStudyHistoryImporter(db).apply(source, {
        kind: "server-logs",
        expectedFingerprint: source.fingerprint,
        importedAt: "2026-09-28T12:00:00.000Z",
        reread: () => {
          createLegacyLogs(join(changing, "two.json"), legacyLog({ sessionId: "18eae214604-3" }));
          return readStudyHistorySource(changing);
        },
      }),
    ).toThrow(/changed during import/);
    expect(counts(db)).toEqual({ history: 0, sources: 0, imports: 0 });
  });

  it("compatibility: history-import:upgrade — upgrades a post-cutover database and reconciles its existing sessions", async () => {
    const w = workspace();
    // The schema before stored history: only the first shipped migration.
    const oldMigrations = join(w.dir, "old-drizzle");
    const [first] = readdirSync(migrationsFolder).toSorted();
    cpSync(join(migrationsFolder, first!), join(oldMigrations, first!), { recursive: true });
    const path = join(w.dir, "server.sqlite");
    const old = new Database({ path, migrationsFolder: oldMigrations, create: true });
    old.migrate();
    const sessions = new StudySessionRepository(old);
    const at = "2026-09-28T10:00:00.000Z";
    const completed = sessions.create(sessionState([5, 6], 0), at);
    sessions.update(
      completed.id,
      1,
      sessionState([5, 6], 2),
      "2026-09-28T10:01:00.000Z",
      "2026-09-28T10:01:00.000Z",
    );
    const quit = sessions.create(sessionState([7, 8], 0), at);
    sessions.update(
      quit.id,
      1,
      sessionState([7, 8], 1),
      "2026-09-28T10:02:00.000Z",
      "2026-09-28T10:02:00.000Z",
    );
    const unlogged = sessions.create(sessionState([9], 0), at);
    sessions.update(
      unlogged.id,
      1,
      sessionState([9], 1),
      "2026-09-28T10:03:00.000Z",
      "2026-09-28T10:03:00.000Z",
    );
    const open = sessions.create(sessionState([10], 0), at);
    // The file-history server wrote these logs at session end.
    for (const [session, outcome] of [
      [sessions.findById(completed.id)!, "completed"],
      [sessions.findById(quit.id)!, "quit"],
    ] as const)
      writeFileSync(
        join(
          w.logs,
          `study-session-${session.startedAt.replaceAll(":", "-").replaceAll(".", "-")}-${session.id}.json`,
        ),
        JSON.stringify(sessionHistoryDocument(session, session.endedAt!, outcome), null, 2) + "\n",
      );
    createLegacyLogs(join(w.logs, "legacy.json"));
    old.close();

    // Before migration the dry run still inventories inputs but cannot apply.
    const pending = database(path, { readonly: true });
    const unready = createStudyHistoryImporter(pending).inventory(
      readStudyHistorySource(w.logs),
      "server-logs",
    );
    expect(unready).toMatchObject({ targetReady: false, ok: false });
    expect(
      unready.inputs
        .map((input) => input.sessionId)
        .filter((id): id is string => typeof id === "string")
        .toSorted(byText),
    ).toEqual([completed.id, quit.id].toSorted(byText));
    pending.close();

    const upgraded = database(path);
    expect(upgraded.migrationState().status).toBe("pending");
    upgraded.migrate();
    expect(upgraded.migrationState().status).toBe("ok");
    const logsBefore = tree(w.logs);
    const report: StudyHistoryImportReport = apply(upgraded, w.logs);
    expect(report.totals).toMatchObject({ imported: 3, linkedSessions: 2, conflicts: 0 });
    expect(report.sessionsWithoutHistory).toEqual([
      { id: unlogged.id, startedAt: at, endedAt: "2026-09-28T10:03:00.000Z" },
    ]);
    expect(
      upgraded.sqlite
        .prepare("SELECT id, session_id AS sessionId, outcome FROM study_history ORDER BY outcome")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { id: completed.id, sessionId: completed.id, outcome: "completed" },
        { id: quit.id, sessionId: quit.id, outcome: "quit" },
        { id: legacySessionId, sessionId: null, outcome: "quit" },
      ]),
    );
    // The unlogged and open sessions are preserved unchanged; nothing guessed their outcome.
    expect(new StudySessionRepository(upgraded).findById(unlogged.id)?.endedAt).toBe(
      "2026-09-28T10:03:00.000Z",
    );
    expect(new StudySessionRepository(upgraded).findById(open.id)?.endedAt).toBeNull();
    expect(apply(upgraded, w.logs).totals).toMatchObject({ alreadyImported: 3, imported: 0 });
    expect(tree(w.logs)).toEqual(logsBefore);
    upgraded.close();

    // A log that disagrees with its stored session is refused.
    const tampered = join(w.dir, "tampered");
    mkdirSync(tampered);
    const doc = JSON.parse(
      readFileSync(
        join(
          w.logs,
          readdirSync(w.logs).find((name) => name.includes(completed.id))!,
        ),
        "utf8",
      ),
    );
    const reopened = database(path);
    const other = new StudySessionRepository(reopened).create(sessionState([11], 0), at);
    new StudySessionRepository(reopened).update(
      other.id,
      1,
      sessionState([11], 1),
      "2026-09-28T11:00:00.000Z",
      "2026-09-28T11:00:00.000Z",
    );
    writeFileSync(
      join(tampered, "log.json"),
      JSON.stringify({
        ...doc,
        sessionId: other.id,
        startedAt: at,
        endedAt: "2026-09-28T11:00:00.000Z",
      }),
    );
    const mismatch = refusal(() => apply(reopened, tampered));
    expect(mismatch.report!.inputs[0]!.problem).toMatch(
      /differs from its stored study session: reviews, selection, sortResult, stats/,
    );
    reopened.close();

    // The upgraded database serves the imported history from SQLite alone.
    const config = testConfig(w.dir, { migrate: false, env: { VOCAB_DATABASE_PATH: path } });
    const { app } = await createTestApp(config);
    try {
      const listed = routes.listStudyHistory.response.parse(
        (
          await request(app.getHttpServer())
            .get(routes.listStudyHistory.path)
            .set("Authorization", `Bearer ${testToken}`)
            .expect(200)
        ).body,
      );
      expect(listed.items.map((item) => item.id).toSorted(byText)).toEqual(
        [completed.id, quit.id, legacySessionId].toSorted(byText),
      );
    } finally {
      await app.close();
    }
  });
});
