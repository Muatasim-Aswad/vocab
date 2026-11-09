import { routes } from "@vocab/contracts";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vite-plus/test";

import { Database } from "../src/infra/db/database.js";
import { MutationReceipts } from "../src/infra/db/mutation-receipts.js";
import { AI_PROVIDER, AI_SLEEP, type AiProvider } from "../src/modules/ai/ai.options.js";
import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

const authorized = (server: Parameters<typeof request>[0]) =>
  request(server).post(routes.generateDraft.path).set("Authorization", `Bearer ${testToken}`);
const providerResponse = (text: string) => ({ text, envelope: { text } });

describe("AI generation boundary", () => {
  it("replays a pre-audit success without inventing provider evidence", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi.fn<AiProvider["generate"]>();
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    try {
      const body = { requestId: uuidv7(), term: "fiets", allowExisting: false };
      const oldResponse = {
        drafts: [{ term: "fiets", corrected: false }],
        warnings: [],
        existing: [],
      };
      app.get(MutationReceipts).execute(body.requestId, "ai:generate", body, () => oldResponse);
      const replay = await authorized(app.getHttpServer()).send(body).expect(200);
      expect(replay.body).toEqual(oldResponse);
      expect(generate).not.toHaveBeenCalled();
      expect(app.get(Database).sqlite.prepare("SELECT 1 FROM ai_requests").get()).toBeUndefined();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("keeps raw invalid output, then records a separate successful execution for the same request", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockResolvedValueOnce(providerResponse("  invalid output  "))
      .mockResolvedValueOnce(providerResponse('  [{"term":"fiets","corrected":false}]  '));
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    try {
      const body = { requestId: uuidv7(), term: "fiets", requestedSense: { senseCue: "rijwiel" } };
      await authorized(app.getHttpServer()).send(body).expect(503);
      await authorized(app.getHttpServer())
        .send({ ...body, term: "huis" })
        .expect(409);
      const success = await authorized(app.getHttpServer()).send(body).expect(200);
      const replay = await authorized(app.getHttpServer()).send(body).expect(200);
      expect(replay.body).toEqual(success.body);
      expect(generate).toHaveBeenCalledTimes(2);
      const db = app.get(Database).sqlite;
      const requestRow = db
        .prepare<unknown[], { input: string }>(
          "SELECT input_json AS input FROM ai_requests WHERE request_id = ?",
        )
        .get(body.requestId)!;
      expect(JSON.parse(requestRow.input)).toMatchObject({ requestedSense: body.requestedSense });
      const generations = db
        .prepare<unknown[], { id: string; outcome: string; errorCode: string | null }>(
          "SELECT id, outcome, error_code AS errorCode FROM ai_generations WHERE request_id = ? ORDER BY execution_number",
        )
        .all(body.requestId);
      expect(generations.map(({ outcome, errorCode }) => [outcome, errorCode])).toEqual([
        ["failure", "invalid_json"],
        ["success", null],
      ]);
      expect(success.body.generationId).toBe(generations[1]!.id);
      const attempts = db
        .prepare<unknown[], { text: string; outcome: string }>(
          "SELECT response_text AS text, processing_outcome AS outcome FROM ai_provider_attempts WHERE generation_id IN (?, ?) ORDER BY started_at",
        )
        .all(generations[0]!.id, generations[1]!.id);
      expect(attempts.map(({ text, outcome }) => [text, outcome])).toEqual([
        ["  invalid output  ", "invalid_json"],
        ['  [{"term":"fiets","corrected":false}]  ', "valid"],
      ]);
      const draft = db
        .prepare<unknown[], { draft: string }>(
          "SELECT draft_json AS draft FROM ai_drafts WHERE generation_id = ?",
        )
        .get(success.body.generationId)!;
      expect(JSON.parse(draft.draft).draftId).toBe(success.body.drafts[0].draftId);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("links a saved draft to the committed entry revision without duplicating events on replay", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockResolvedValue(providerResponse('[{"term":"fiets","corrected":false}]'));
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    try {
      const generated = await authorized(app.getHttpServer())
        .send({ requestId: uuidv7(), term: "fiets" })
        .expect(200);
      const { generationId, drafts } = generated.body;
      const event = { eventId: uuidv7(), draftId: drafts[0].draftId, eventType: "presented" };
      const eventRequest = () =>
        request(app.getHttpServer())
          .post(routes.recordAiDraftEvent.path)
          .set("Authorization", `Bearer ${testToken}`);
      await eventRequest().send(event).expect(200);
      await eventRequest().send(event).expect(200);
      await eventRequest()
        .send({ ...event, eventType: "skipped" })
        .expect(409);
      const body = {
        mutationId: uuidv7(),
        entry: { lemma: "fiets", language: "nl" },
        ai: {
          generationId,
          drafts: [{ draftId: drafts[0].draftId, editableBaseline: { term: "fiets" } }],
        },
      };
      const create = () =>
        request(app.getHttpServer())
          .post(routes.createEntry.path)
          .set("Authorization", `Bearer ${testToken}`);
      const first = await create().send(body).expect(200);
      await create().send(body).expect(200);
      const db = app.get(Database).sqlite;
      const saved = db
        .prepare<unknown[], { entryId: number; revision: number; snapshot: string }>(
          "SELECT entry_id AS entryId, revision_after AS revision, persisted_entry_json AS snapshot FROM ai_draft_events WHERE mutation_id = ?",
        )
        .all(body.mutationId);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.entryId).toBe(first.body.entry.id);
      expect(saved[0]!.revision).toBe(first.body.entry.revision);
      expect(JSON.parse(saved[0]!.snapshot).lemma).toBe("fiets");
      const updateBody = {
        mutationId: uuidv7(),
        expectedRevision: first.body.entry.revision,
        changes: { extra: "bicycle" },
        ai: { generationId, drafts: [{ draftId: drafts[0].draftId }] },
      };
      const updated = await request(app.getHttpServer())
        .patch(routes.updateEntry.path.replace(":id", String(first.body.entry.id)))
        .set("Authorization", `Bearer ${testToken}`)
        .send(updateBody)
        .expect(200);
      const updateEvent = db
        .prepare<
          unknown[],
          { beforeRevision: number; afterRevision: number; previous: string; persisted: string }
        >(
          "SELECT revision_before AS beforeRevision, revision_after AS afterRevision, previous_entry_json AS previous, persisted_entry_json AS persisted FROM ai_draft_events WHERE mutation_id = ?",
        )
        .get(updateBody.mutationId)!;
      expect(updateEvent.beforeRevision).toBe(first.body.entry.revision);
      expect(updateEvent.afterRevision).toBe(updated.body.entry.revision);
      expect(JSON.parse(updateEvent.previous).extra).toBeUndefined();
      expect(JSON.parse(updateEvent.persisted).extra).toBe("bicycle");
      const rejected = await create()
        .send({
          mutationId: uuidv7(),
          entry: { lemma: "huis", language: "nl" },
          ai: { generationId, drafts: [{ draftId: uuidv7() }] },
        })
        .expect(400);
      expect(rejected.body.error.message).toBe("Unknown AI draft reference");
      expect(db.prepare("SELECT 1 FROM entries WHERE lemma = 'huis'").get()).toBeUndefined();
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: ai:provider — uses the default model and prompts and only returns unsaved drafts", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockResolvedValue(
        providerResponse(
          '[{"term":"fiets","corrected":false,"extra":"bicycle","irregular":true,"separable":false,"uncountable":true}]',
        ),
      );
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    try {
      const body = { requestId: uuidv7(), term: "fiets", allowExisting: false };
      const first = await authorized(app.getHttpServer()).send(body).expect(200);
      expect(routes.generateDraft.response.parse(first.body).drafts[0]).toMatchObject({
        term: "fiets",
        extra: "bicycle",
        irregular: true,
        separable: false,
        uncountable: true,
      });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0]?.[0]).toMatchObject({
        model: "gemini-3.8-flash",
        contents: "Input term: fiets",
      });
      expect(generate.mock.calls[0]?.[0].systemInstruction).toContain("Dutch single-word lemma");
      expect(
        await authorized(app.getHttpServer())
          .send(body)
          .expect(200)
          .then((res) => res.body),
      ).toEqual(first.body);
      expect(generate).toHaveBeenCalledTimes(1);
      await authorized(app.getHttpServer())
        .send({ ...body, term: "huis" })
        .expect(409);
      const list = await request(app.getHttpServer())
        .get(routes.listEntries.path)
        .set("Authorization", `Bearer ${testToken}`);
      expect(list.body.items ?? []).toEqual([]);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("adds excluded and requested senses to the model input and rejects an empty sense", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockResolvedValue(
        providerResponse('[{"term":"bank","corrected":false,"senseCue":"zandbank"}]'),
      );
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    try {
      await authorized(app.getHttpServer())
        .send({
          requestId: uuidv7(),
          term: "bank",
          excludeSenses: [{ senseCue: "geld", example: "Ik breng geld naar de bank." }],
          requestedSense: { senseCue: "zandbank" },
        })
        .expect(200);
      expect(generate.mock.calls[0]?.[0].contents).toBe(
        [
          "Input term: bank",
          "",
          "Senses to exclude (do not return these senses):",
          "- senseCue: geld; example: Ik breng geld naar de bank.",
          "",
          "Requested sense (return only this sense):",
          "- senseCue: zandbank",
        ].join("\n"),
      );
      await authorized(app.getHttpServer())
        .send({ requestId: uuidv7(), term: "bank", requestedSense: {} })
        .expect(400);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("matches a candidate meaning against its term's entries, audits it and replays the decision", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    const generate = vi.fn<AiProvider["generate"]>();
    const { app } = await createTestApp(config, {
      overrides: [{ token: AI_PROVIDER, value: { generate } }],
    });
    const post = (path: string) =>
      request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${testToken}`);
    const create = async (entry: object) =>
      routes.createEntry.response.parse(
        (await post(routes.createEntry.path).send({ mutationId: uuidv7(), entry }).expect(200))
          .body,
      ).entry.id;
    try {
      await create({ lemma: "rennen", senseCue: "sport" });
      const lopen = await create({
        lemma: "lopen",
        extra: "to run",
        forms: ["liep"],
        relatedTokens: ["+rennen", "-staan"],
      });
      const huis = await create({ lemma: "het huis" });
      const draft = { term: "lopen", extra: "to walk", examples: ["Wij lopen samen."] };
      const decision = {
        decision: "new",
        senseCue: "Walk",
        backfills: [{ id: lopen, senseCue: "run" }],
      };
      generate.mockResolvedValueOnce(
        providerResponse(JSON.stringify({ ...decision, reason: "Walking differs from running." })),
      );
      const body = { requestId: uuidv7(), draft, entryIds: [lopen] };
      const first = await post(routes.matchMeaning.path).send(body).expect(200);
      expect(routes.matchMeaning.response.parse(first.body)).toEqual({
        decision: "new",
        senseCue: "walk",
        backfills: [{ id: lopen, senseCue: "run" }],
        reason: "Walking differs from running.",
        compared: [{ id: lopen, revision: 1 }],
      });
      expect(generate.mock.calls[0]?.[0].contents).toBe(
        [
          "Term: lopen",
          `Candidate meaning:\n${JSON.stringify(draft)}`,
          `Existing entries:\n${JSON.stringify({
            id: lopen,
            status: "active",
            extra: "to run",
            forms: ["liep"],
            relations: [
              { type: "synonym", term: "rennen", senseCue: "sport" },
              { type: "antonym", term: "staan" },
            ],
          })}`,
        ].join("\n\n"),
      );
      expect(await post(routes.matchMeaning.path).send(body).expect(200)).toHaveProperty(
        "body",
        first.body,
      );
      expect(generate).toHaveBeenCalledTimes(1);
      const db = app.get(Database).sqlite;
      expect(
        db
          .prepare(
            "SELECT m.match_json AS match, p.kind FROM ai_meaning_matches m JOIN ai_generations g ON g.id = m.generation_id JOIN ai_prompt_versions p ON p.sha256 = g.prompt_sha256",
          )
          .get(),
      ).toEqual({
        match: JSON.stringify({
          decision: "new",
          senseCue: "walk",
          backfills: [{ id: lopen, senseCue: "run" }],
          reason: "Walking differs from running.",
        }),
        kind: "meaning-match",
      });

      generate.mockResolvedValueOnce(
        providerResponse('{"decision":"same","entryId":999,"reason":"Same."}'),
      );
      const invalid = { requestId: uuidv7(), draft, entryIds: [lopen] };
      await post(routes.matchMeaning.path).send(invalid).expect(503);
      expect(
        db
          .prepare(
            "SELECT g.outcome, g.error_code AS code, a.processing_outcome AS processing FROM ai_generations g JOIN ai_provider_attempts a ON a.generation_id = g.id WHERE g.request_id = ?",
          )
          .get(invalid.requestId),
      ).toEqual({ outcome: "failure", code: "invalid_match", processing: "invalid_match" });

      const refused = (overrides: object, status: number) =>
        post(routes.matchMeaning.path)
          .send({ requestId: uuidv7(), draft, entryIds: [lopen], ...overrides })
          .expect(status);
      await refused({ draft: { term: "lopen", partOfSpeech: "VERB" } }, 400);
      await refused({ entryIds: [huis] }, 400);
      await refused({ entryIds: [lopen, 999] }, 404);
      await refused({ draftId: uuidv7() }, 400);
      expect(generate).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: ai:timeout — retries 503 and 429 at virtual 8/16-second delays, then bounds a hung provider", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, { env: { VOCAB_GEMINI_API_KEY: "fake-key" } });
    config.ai.timeoutMs = 60;
    const delays: number[] = [];
    const generate = vi
      .fn<AiProvider["generate"]>()
      .mockRejectedValueOnce({ status: "UNAVAILABLE" })
      .mockRejectedValueOnce({ error: { code: 429 } })
      .mockResolvedValueOnce(providerResponse('[{"term":"fiets","corrected":false}]'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { app } = await createTestApp(config, {
      overrides: [
        { token: AI_PROVIDER, value: { generate } },
        {
          token: AI_SLEEP,
          value: async (ms: number) => {
            delays.push(ms);
          },
        },
      ],
    });
    try {
      await authorized(app.getHttpServer())
        .send({ requestId: uuidv7(), term: "fiets" })
        .expect(200);
      expect(delays).toEqual([8000, 16000]);
      const timeout = await authorized(app.getHttpServer())
        .send({ requestId: uuidv7(), term: "huis" })
        .expect(503);
      expect(timeout.body.error.message).toBe("AI generation timed out");
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
