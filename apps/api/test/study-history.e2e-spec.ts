import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { routes } from "@vocab/contracts";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { AppConfig } from "../src/config.js";
import { Database } from "../src/infra/db/database.js";
import { AnswerScore } from "../src/modules/study/memory.js";
import {
  createStudyHistoryImporter,
  readStudyHistorySource,
} from "../src/modules/study/study-history-import.service.js";
import { StudyService } from "../src/modules/study/study.service.js";
import { createLegacyLogs, legacyLog } from "./fixtures/legacy.js";
import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).toReversed()) await step();
});

type Session = ReturnType<typeof routes.startStudy.response.parse>;

async function setup(options: { env?: Record<string, string> } = {}) {
  const dir = tempDir();
  cleanup.push(dir.cleanup);
  const config = testConfig(dir.dir, options);
  return { dir: dir.dir, config, ...(await open(config)) };
}

async function open(config: AppConfig) {
  const { app } = await createTestApp(config);
  let closed = false;
  const close = async () => {
    if (!closed) await app.close();
    closed = true;
  };
  cleanup.push(close);
  return { app, close, ...client(app) };
}

const endBody = (session: Session, outcome: "completed" | "quit" = "completed") => ({
  mutationId: uuidv7(),
  expectedRevision: session.revision,
  outcome,
});

function client(app: NestExpressApplication) {
  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set("Authorization", `Bearer ${testToken}`);
  const post = (path: string, body: object) =>
    http().post(path).set("Authorization", `Bearer ${testToken}`).send(body);
  const create = async (lemma: string) =>
    routes.createEntry.response.parse(
      (await post(routes.createEntry.path, { mutationId: uuidv7(), entry: { lemma } }).expect(200))
        .body,
    ).entry;
  const start = async (maxWords: number) =>
    routes.startStudy.response.parse(
      (await post(routes.startStudy.path, { mutationId: uuidv7(), maxWords }).expect(200)).body,
    );
  const answer = async (session: Session, answerScore = 1, answerTimeMs = 1500) =>
    routes.answerStudy.response.parse(
      (
        await post(routes.answerStudy.path.replace(":id", session.id), {
          mutationId: uuidv7(),
          expectedRevision: session.revision,
          entryId: session.words[session.nextIndex]!.id,
          answerScore,
          answerTimeMs,
        }).expect(200)
      ).body,
    ).session;
  const end = (session: Session, body: ReturnType<typeof endBody>) =>
    post(routes.endStudy.path.replace(":id", session.id), body);
  const history = async (id: string) =>
    routes.getStudyHistory.response.parse(
      (await get(routes.getStudyHistory.path.replace(":id", encodeURIComponent(id))).expect(200))
        .body,
    );
  const list = async (query = "") =>
    routes.listStudyHistory.response.parse(
      (await get(`${routes.listStudyHistory.path}${query}`).expect(200)).body,
    );
  return { http, get, post, create, start, answer, endBody, end, history, list };
}

function withDatabase<T>(config: AppConfig, operation: (database: Database) => T): T {
  const database = new Database(config.database);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

const count = (config: AppConfig, sql: string, ...params: unknown[]) =>
  withDatabase(
    config,
    (database) => database.sqlite.prepare<unknown[], { count: number }>(sql).get(...params)?.count,
  );

describe("database-only study history", () => {
  it("compatibility: log:fields — stores schema v2 selection, order, reviews, memory and statistics", async () => {
    const t = await setup({ env: { STUDY_LOGS_PATH: "logs-that-must-not-exist" } });
    await t.create("fiets");
    await t.create("boom");
    let session = await t.start(2);
    session = await t.answer(session, 1, 1300);
    session = await t.answer(session, 0, 4200);
    const ended = routes.endStudy.response.parse(
      (await t.end(session, t.endBody(session)).expect(200)).body,
    );
    const record = await t.history(session.id);
    expect(record).toMatchObject({
      id: session.id,
      sessionId: session.id,
      origin: "api",
      startedAt: session.startedAt,
      endedAt: ended.endedAt,
      outcome: "completed",
      reviewCount: 2,
    });
    const { document } = record;
    expect(document).toMatchObject({
      schemaVersion: 2,
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: ended.endedAt,
      selection: { type: "top", maxWords: 2 },
      sortResult: session.words.map((word) => ({
        id: word.id,
        term: word.lemma,
        priority: word.priority,
      })),
      stats: { totalWords: 2, wordsReviewed: 2, knowCount: 1, noCount: 1 },
      outcome: { status: "completed" },
    });
    expect(document.reviews.map((review) => review.id)).toEqual(session.words.map((w) => w.id));
    for (const [index, review] of document.reviews.entries()) {
      const word = session.words[index]!;
      const current = routes.getEntry.response.parse(
        (await t.get(routes.getEntry.path.replace(":id", String(word.id))).expect(200)).body,
      ).entry.memory!;
      expect(review).toMatchObject({
        term: word.lemma,
        priority: word.priority,
        reviewedAt: expect.any(String),
        before: {
          strength: word.memory!.strength,
          difficulty: word.memory!.difficulty,
          streak: word.memory!.streak,
          lastReviewed: word.memory!.lastReviewed,
        },
        after: {
          strength: current.strength,
          difficulty: current.difficulty,
          streak: current.streak,
        },
        internals: { answerScore: index === 0 ? 1 : 0, answerTime: index === 0 ? 1300 : 4200 },
      });
    }
    // Only SQLite files exist: no logs directory, even when the retired setting is present.
    expect(readdirSync(t.dir).toSorted()).toEqual(["test.db", "test.db-shm", "test.db-wal"]);
  });

  it("reviews change only study memory, so entry revisions and the recently modified order follow content edits", async () => {
    const t = await setup();
    const fiets = await t.create("fiets");
    await t.create("boom");
    const recent = async () =>
      routes.listEntries.response
        .parse((await t.get(`${routes.listEntries.path}?order=modified`).expect(200)).body)
        .items.map((item) => item.lemma);
    const entry = async (id: number) =>
      routes.getEntry.response.parse(
        (await t.get(routes.getEntry.path.replace(":id", String(id))).expect(200)).body,
      ).entry;

    let session = await t.start(2);
    const { id: reviewedId, memory: before } = session.words[0]!;
    session = await t.answer(session, 1);
    session = await t.answer(session, 0);
    const reviewed = await entry(reviewedId);
    expect(reviewed.revision).toBe(1);
    expect(reviewed.memory).not.toEqual(before);
    expect(await recent()).toEqual(["boom", "fiets"]);

    await t
      .http()
      .patch(routes.updateEntry.path.replace(":id", String(fiets.id)))
      .set("Authorization", `Bearer ${testToken}`)
      .send({ mutationId: uuidv7(), expectedRevision: 1, changes: { extra: "bicycle" } })
      .expect(200);
    expect(await recent()).toEqual(["fiets", "boom"]);

    // An entry edited after the session read it refuses the stale review.
    const stale = await t.start(2);
    const editedId = stale.words[0]!.id;
    const revision = (await entry(editedId)).revision;
    await t
      .http()
      .patch(routes.updateEntry.path.replace(":id", String(editedId)))
      .set("Authorization", `Bearer ${testToken}`)
      .send({ mutationId: uuidv7(), expectedRevision: revision, changes: { extra: "changed" } })
      .expect(200);
    await t
      .post(routes.answerStudy.path.replace(":id", stale.id), {
        mutationId: uuidv7(),
        expectedRevision: stale.revision,
        entryId: editedId,
        answerScore: 1,
        answerTimeMs: 1500,
      })
      .expect(409);
  });

  it("compatibility: log:outcomes — completed, quit and error outcomes keep exact times", async () => {
    const t = await setup();
    await t.create("appel");
    await t.create("peer");
    const study = t.app.get(StudyService);
    const started = study.startStudySession({
      maxWords: 2,
      nowMs: Date.parse("2024-04-05T12:00:00.000Z"),
    });
    const answered = study.answerStudySession(
      started.id,
      started.revision,
      started.state.sessionWords[0]!.id,
      AnswerScore.KNOW,
      900,
      Date.parse("2024-04-05T12:00:01.000Z"),
    ).session;
    study.endStudySession(
      started.id,
      answered.revision,
      "quit",
      Date.parse("2024-04-05T12:00:02.000Z"),
    );
    const quit = await t.history(started.id);
    expect(quit).toMatchObject({
      startedAt: "2024-04-05T12:00:00.000Z",
      endedAt: "2024-04-05T12:00:02.000Z",
      outcome: "quit",
      reviewCount: 1,
    });
    expect(quit.document.reviews[0]).toMatchObject({ reviewedAt: "2024-04-05T12:00:01.000Z" });
    expect(quit.document.stats).toMatchObject({ totalWords: 2, wordsReviewed: 1 });

    // Legacy error outcomes arrive only through the explicit importer and keep their message.
    const logs = join(t.dir, "legacy-logs");
    mkdirSync(logs);
    const error = legacyLog({
      sessionId: "18eae214601-3",
      reviews: [],
      endedAt: "2024-04-06T08:00:00.123Z",
      outcome: { status: "error", message: "interrupted" },
    });
    createLegacyLogs(join(logs, "error.json"), error);
    const source = readStudyHistorySource(logs);
    withDatabase(t.config, (database) =>
      createStudyHistoryImporter(database).apply(source, {
        kind: "server-logs",
        expectedFingerprint: source.fingerprint,
        importedAt: "2026-09-28T00:00:00.000Z",
      }),
    );
    const imported = await t.history("18eae214601-3");
    expect(imported).toMatchObject({
      sessionId: null,
      origin: "import",
      endedAt: "2024-04-06T08:00:00.123Z",
      outcome: "error",
      reviewCount: 0,
    });
    expect(imported.document).toEqual(error);
  });

  it("compatibility: history:atomic — completion, final history and the mutation receipt roll back together", async () => {
    const t = await setup();
    await t.create("tafel");
    let session = await t.start(1);
    session = await t.answer(session);
    withDatabase(t.config, (database) =>
      database.sqlite.exec(
        "CREATE TRIGGER inject_history_failure BEFORE INSERT ON study_history BEGIN SELECT RAISE(ABORT, 'injected'); END",
      ),
    );
    const body = t.endBody(session);
    const failed = await t.end(session, body).expect(500);
    expect(failed.body.error.code).toBe("internal");
    const openSession = routes.getStudy.response.parse(
      (await t.get(routes.getStudy.path.replace(":id", session.id)).expect(200)).body,
    );
    expect(openSession).toMatchObject({ endedAt: null, revision: session.revision });
    expect(count(t.config, "SELECT COUNT(*) AS count FROM study_history")).toBe(0);
    expect(
      count(
        t.config,
        "SELECT COUNT(*) AS count FROM mutation_receipts WHERE mutation_id = ?",
        body.mutationId,
      ),
    ).toBe(0);
    await t.get(routes.getStudyHistory.path.replace(":id", session.id)).expect(404);

    withDatabase(t.config, (database) =>
      database.sqlite.exec("DROP TRIGGER inject_history_failure"),
    );
    const retried = await t.end(session, body).expect(200);
    expect(retried.body.endedAt).toBeTruthy();
    expect((await t.history(session.id)).outcome).toBe("completed");
    expect((await t.list()).items).toHaveLength(1);
  });

  it("compatibility: history:replay — a committed but lost response replays after restart without another record", async () => {
    const t = await setup();
    await t.create("stoel");
    let session = await t.start(1);
    session = await t.answer(session);
    const body = t.endBody(session);
    const first = await t.end(session, body).expect(200);
    const record = await t.history(session.id);
    await t.close();

    const restarted = await open(t.config);
    const replay = await restarted.end(session, body).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(await restarted.history(session.id)).toEqual(record);
    expect(
      count(
        t.config,
        "SELECT COUNT(*) AS count FROM study_history WHERE session_id = ?",
        session.id,
      ),
    ).toBe(1);
    // A new identity after completion is a conflict, never a second record.
    await restarted.end(session, restarted.endBody(session)).expect(409);
    expect((await restarted.list()).items).toHaveLength(1);
  });

  it("compatibility: history:export — authenticated bounded listing and export, including imported-only records", async () => {
    const t = await setup();
    const kast = await t.create("kast");
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      let session = await t.start(1);
      session = await t.answer(session);
      await t.end(session, t.endBody(session)).expect(200);
      ids.push(session.id);
    }
    const logs = join(t.dir, "imported-logs");
    mkdirSync(logs);
    const legacy = legacyLog({ legacyField: { kept: true } });
    createLegacyLogs(join(logs, "legacy.json"), legacy);
    const source = readStudyHistorySource(logs);
    withDatabase(t.config, (database) =>
      createStudyHistoryImporter(database).apply(source, {
        kind: "server-logs",
        expectedFingerprint: source.fingerprint,
        importedAt: "2026-09-28T00:00:00.000Z",
      }),
    );

    await t.http().get(routes.listStudyHistory.path).expect(401);
    await t.http().get(`/api/study/history/${ids[0]}`).expect(401);

    const first = await t.list("?limit=2");
    expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(first.metadata.next_cursor).toBeTruthy();
    const second = await t.list(`?limit=2&cursor=${first.metadata.next_cursor}`);
    expect(second.items.map((item) => item.id)).toEqual([ids[0], legacy.sessionId]);
    expect(second.metadata.next_cursor).toBeNull();
    expect(second.items[1]).toMatchObject({ origin: "import", sessionId: null, outcome: "quit" });
    await t.get(`${routes.listStudyHistory.path}?cursor=not-a-cursor`).expect(400);
    await t.get(`${routes.listStudyHistory.path}?limit=101`).expect(400);
    await t.get("/api/study/history/unknown-record").expect(404);
    await t.get("/api/study/history/..%2Fetc").expect(400);

    // Imported records export every historical field; deleting vocabulary never changes history.
    const exported = await t.history(String(legacy.sessionId));
    expect(exported.document).toEqual(legacy);
    const before = await t.history(ids[0]!);
    const detail = routes.getEntry.response.parse(
      (await t.get(routes.getEntry.path.replace(":id", String(kast.id))).expect(200)).body,
    );
    await t
      .http()
      .delete(routes.deleteEntry.path.replace(":id", String(kast.id)))
      .set("Authorization", `Bearer ${testToken}`)
      .send({ mutationId: uuidv7(), expectedRevision: detail.entry.revision })
      .expect(200);
    await t.get(routes.getEntry.path.replace(":id", String(kast.id))).expect(404);
    expect(await t.history(ids[0]!)).toEqual(before);
    expect(before.document.reviews[0]!.id).toBe(kast.id);
  });

  it("compatibility: history:immutable — records are immutable in the database", async () => {
    const t = await setup();
    await t.create("zee");
    let session = await t.start(1);
    session = await t.answer(session);
    await t.end(session, t.endBody(session)).expect(200);
    withDatabase(t.config, (database) => {
      expect(() =>
        database.sqlite.prepare("UPDATE study_history SET outcome = 'quit'").run(),
      ).toThrow(/immutable/);
      expect(() => database.sqlite.prepare("DELETE FROM study_history").run()).toThrow(/immutable/);
    });
    expect((await t.history(session.id)).outcome).toBe("completed");
  });

  it("compatibility: history:restore — a database-only backup restores and serves complete history", async () => {
    const t = await setup();
    await t.create("huis");
    let session = await t.start(1);
    session = await t.answer(session);
    await t.end(session, t.endBody(session)).expect(200);
    const logs = join(t.dir, "legacy-logs");
    mkdirSync(logs);
    createLegacyLogs(join(logs, "legacy.json"));
    const source = readStudyHistorySource(logs);
    withDatabase(t.config, (database) =>
      createStudyHistoryImporter(database).apply(source, {
        kind: "server-logs",
        expectedFingerprint: source.fingerprint,
        importedAt: "2026-09-28T00:00:00.000Z",
      }),
    );
    const listed = await t.list();
    const exports = await Promise.all(listed.items.map((item) => t.history(item.id)));
    await t.close();

    // The backup is the SQLite file alone: no log directory accompanies it.
    const restoreDir = tempDir();
    cleanup.push(restoreDir.cleanup);
    const database = new Database(t.config.database);
    try {
      await database.sqlite.backup(join(restoreDir.dir, "test.db"));
    } finally {
      database.close();
    }
    expect(readdirSync(restoreDir.dir)).toEqual(["test.db"]);
    const restoredConfig = testConfig(restoreDir.dir, { migrate: false });
    const restored = await open(restoredConfig);
    expect(await restored.list()).toEqual(listed);
    for (const record of exports) expect(await restored.history(record.id)).toEqual(record);
    expect(readdirSync(restoreDir.dir).filter((name) => !name.startsWith("test.db"))).toEqual([]);
  });
});
