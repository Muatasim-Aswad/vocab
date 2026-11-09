import { readdirSync } from "node:fs";

import { routes } from "@vocab/contracts";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vite-plus/test";

import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

describe("vocabulary and study HTTP operations", () => {
  it("prepares article nouns and reflexive verbs from the display term", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const prepare = (term: string) =>
      request(app.getHttpServer())
        .post(routes.prepareEntry.path)
        .set("Authorization", `Bearer ${testToken}`)
        .send({ term });
    try {
      const noun = await prepare("de tafel").expect(200);
      expect(routes.prepareEntry.response.parse(noun.body).inferred).toMatchObject({
        lemma: "tafel",
        partOfSpeech: "NOUN",
        grammar: { article: "de" },
      });

      const verb = await prepare("zich vergissen").expect(200);
      expect(routes.prepareEntry.response.parse(verb.body).inferred).toMatchObject({
        lemma: "vergissen",
        partOfSpeech: "VERB",
        tags: expect.arrayContaining(["reflexive"]),
      });

      await request(app.getHttpServer())
        .post(routes.createEntry.path)
        .set("Authorization", `Bearer ${testToken}`)
        .send({
          mutationId: uuidv7(),
          entry: { lemma: "de tafel", examples: ["De tafel is rond."] },
        })
        .expect(200);
      const existing = await prepare("de tafel").expect(200);
      expect(routes.prepareEntry.response.parse(existing.body).matches).toEqual([
        expect.objectContaining({ lemma: "tafel", examples: ["De tafel is rond."] }),
      ]);

      await request(app.getHttpServer())
        .post(routes.createEntry.path)
        .set("Authorization", `Bearer ${testToken}`)
        .send({ mutationId: uuidv7(), entry: { lemma: "lopen", forms: ["liep", "gelopen"] } })
        .expect(200);
      const form = routes.prepareEntry.response.parse((await prepare("Liep").expect(200)).body);
      expect(form.matches).toEqual([]);
      expect(form.formOf).toEqual([expect.objectContaining({ lemma: "lopen" })]);
      const lemma = routes.prepareEntry.response.parse((await prepare("lopen").expect(200)).body);
      expect(lemma.formOf).toEqual([]);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("creates, finds and edits entries with idempotent retries and revision checks", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post" | "patch" | "delete", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    try {
      const body = { mutationId: uuidv7(), entry: { lemma: "fiets", extra: "bicycle" } };
      const first = await auth("post", routes.createEntry.path).send(body).expect(200);
      const created = routes.createEntry.response.parse(first.body);
      expect(created.entry).toMatchObject({ lemma: "fiets", revision: 1, extra: "bicycle" });
      const id = created.entry.id;
      expect((await auth("post", routes.createEntry.path).send(body).expect(200)).body).toEqual(
        first.body,
      );
      const reused = await auth("post", routes.createEntry.path)
        .send({ ...body, entry: { lemma: "huis" } })
        .expect(409);
      expect(reused.body.error).toMatchObject({
        reason: "MUTATION_IDENTITY_REUSED",
        message: "Mutation identity was reused with different content",
      });
      expect(
        (await auth("get", routes.getEntry.path.replace(":id", String(id))).expect(200)).body.entry
          .id,
      ).toBe(id);
      expect(
        (await auth("get", routes.lookupEntry.path).query({ term: "fiets" }).expect(200)).body,
      ).toHaveLength(1);
      expect(
        (await auth("get", routes.searchEntries.path).query({ query: "fiets" }).expect(200)).body
          .items[0].id,
      ).toBe(id);
      const forms = await auth("post", routes.resolveForms.path)
        .send({ term: "fiets", partOfSpeech: "NOUN", providedForms: ["fietsen"] })
        .expect(200);
      expect(routes.resolveForms.response.parse(forms.body)).toMatchObject({
        providedForms: ["fietsen"],
        conflict: true,
      });
      const update = { mutationId: uuidv7(), expectedRevision: 1, changes: { extra: "a bicycle" } };
      const changed = await auth("patch", routes.updateEntry.path.replace(":id", String(id)))
        .send(update)
        .expect(200);
      expect(changed.body.entry.revision).toBe(2);
      const stale = await auth("patch", routes.updateEntry.path.replace(":id", String(id)))
        .send({ ...update, mutationId: uuidv7() })
        .expect(409);
      expect(stale.body.error).toMatchObject({
        reason: "REVISION_CONFLICT",
        details: { currentRevision: 2 },
      });
      expect(stale.body.error).not.toHaveProperty("cause");
      const deleteBody = { mutationId: uuidv7(), expectedRevision: 2 };
      await auth("delete", routes.deleteEntry.path.replace(":id", String(id)))
        .send(deleteBody)
        .expect(200);
      await auth("delete", routes.deleteEntry.path.replace(":id", String(id)))
        .send(deleteBody)
        .expect(200);
      await auth("get", routes.getEntry.path.replace(":id", String(id))).expect(404);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("returns the separable particle and linked words' articles with an entry", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    const create = async (entry: Record<string, unknown>) =>
      routes.createEntry.response.parse(
        (
          await auth("post", routes.createEntry.path)
            .send({ mutationId: uuidv7(), entry })
            .expect(200)
        ).body,
      ).entry;
    const detail = async (id: number) =>
      routes.getEntry.response.parse(
        (await auth("get", routes.getEntry.path.replace(":id", String(id))).expect(200)).body,
      );
    try {
      const noun = await create({
        lemma: "opstand",
        partOfSpeech: "NOUN",
        grammar: { article: "de" },
      });
      const verb = await create({
        lemma: "opstaan",
        partOfSpeech: "VERB",
        grammar: { isSeparable: true, irregular: true },
        forms: ["sta op", "stond op", "is opgestaan"],
        relatedTokens: [`~id:${noun.id}`],
      });

      const verbDetail = await detail(verb.id);
      expect(verbDetail.separablePart).toBe("op");
      expect(verbDetail.relations).toEqual([
        { type: "wordFamily", entry: expect.objectContaining({ lemma: "opstand", article: "de" }) },
      ]);
      expect((await detail(noun.id)).separablePart).toBeUndefined();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("lists a stub with the words related to it, and an active entry without them", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    try {
      await auth("post", routes.createEntry.path)
        .send({
          mutationId: uuidv7(),
          entry: {
            lemma: "de fiets",
            partOfSpeech: "NOUN",
            relatedTokens: ["+rijwiel"],
          },
        })
        .expect(200);
      const search = routes.searchEntries.response.parse(
        (await auth("get", `${routes.searchEntries.path}?query=rijwiel`).expect(200)).body,
      );
      expect(search.items.find((item) => item.lemma === "rijwiel")).toMatchObject({
        status: "stub",
        relations: [
          { type: "synonym", entry: expect.objectContaining({ lemma: "fiets", article: "de" }) },
        ],
      });
      const prepared = routes.prepareEntry.response.parse(
        (await auth("post", routes.prepareEntry.path).send({ term: "rijwiel" }).expect(200)).body,
      );
      expect(prepared.matches[0]!.relations).toHaveLength(1);
      const active = routes.searchEntries.response.parse(
        (await auth("get", `${routes.searchEntries.path}?query=fiets`).expect(200)).body,
      );
      expect(active.items.find((item) => item.lemma === "fiets")!.relations).toBeUndefined();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("clears grammar values an edit sends as null", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "post" | "patch", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    try {
      const created = routes.createEntry.response.parse(
        (
          await auth("post", routes.createEntry.path)
            .send({
              mutationId: uuidv7(),
              entry: {
                lemma: "schaar",
                partOfSpeech: "NOUN",
                grammar: { article: "de", number: "plural", isCountable: true },
              },
            })
            .expect(200)
        ).body,
      ).entry;
      expect(created.grammar).toMatchObject({ article: "de", number: "plural", isCountable: true });
      const edited = routes.updateEntry.response.parse(
        (
          await auth("patch", routes.updateEntry.path.replace(":id", String(created.id)))
            .send({
              mutationId: uuidv7(),
              expectedRevision: created.revision,
              changes: { grammar: { article: null, number: null, isCountable: null } },
            })
            .expect(200)
        ).body,
      ).entry;
      expect(edited.grammar).toBeUndefined();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("applies a study answer once, rejects stale concurrent answers and stores final history", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir);
    const { app } = await createTestApp(config);
    const auth = (method: "get" | "post", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    try {
      await auth("post", routes.createEntry.path)
        .send({ mutationId: uuidv7(), entry: { lemma: "fiets" } })
        .expect(200);
      const started = await auth("post", routes.startStudy.path)
        .send({ mutationId: uuidv7(), maxWords: 1 })
        .expect(200);
      const session = routes.startStudy.response.parse(started.body);
      expect(session.words).toHaveLength(1);
      const path = routes.answerStudy.path.replace(":id", session.id);
      const answer = {
        mutationId: uuidv7(),
        expectedRevision: session.revision,
        entryId: session.words[0]!.id,
        answerScore: 1,
        answerTimeMs: 1300,
      };
      const first = await auth("post", path).send(answer).expect(200);
      expect(first.body.session.stats.wordsReviewed).toBe(1);
      expect((await auth("post", path).send(answer).expect(200)).body).toEqual(first.body);
      await auth("post", path)
        .send({ ...answer, mutationId: uuidv7() })
        .expect(409);
      const ended = await auth("post", routes.endStudy.path.replace(":id", session.id))
        .send({
          mutationId: uuidv7(),
          expectedRevision: first.body.session.revision,
          outcome: "completed",
        })
        .expect(200);
      expect(ended.body.endedAt).toBeTruthy();
      const history = routes.getStudyHistory.response.parse(
        (await auth("get", `/api/study/history/${session.id}`).expect(200)).body,
      );
      expect(history).toMatchObject({
        sessionId: session.id,
        outcome: "completed",
        reviewCount: 1,
      });
      expect(readdirSync(dir.dir).toSorted()).toEqual(["test.db", "test.db-shm", "test.db-wal"]);
      expect(
        (await auth("get", routes.getStudy.path.replace(":id", session.id)).expect(200)).body.stats
          .wordsReviewed,
      ).toBe(1);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
