import { routes } from "@vocab/contracts";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vite-plus/test";

import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

describe("captures HTTP operations", () => {
  it("keeps captures outside vocabulary, deduplicates terms, pages, and deletes with retry receipts", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post" | "delete", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    try {
      const firstBody = { mutationId: uuidv7(), term: "  de   fiets  " };
      const first = (await auth("post", routes.createCapture.path).send(firstBody).expect(200))
        .body;
      expect(routes.createCapture.response.parse(first)).toMatchObject({ term: "de fiets" });
      expect(
        (await auth("post", routes.createCapture.path).send(firstBody).expect(200)).body,
      ).toEqual(first);
      expect(
        (
          await auth("post", routes.createCapture.path)
            .send({ mutationId: uuidv7(), term: "DE Fiets" })
            .expect(200)
        ).body.id,
      ).toBe(first.id);
      const second = (
        await auth("post", routes.createCapture.path)
          .send({ mutationId: uuidv7(), term: "lopen" })
          .expect(200)
      ).body;

      const page = (await auth("get", routes.listCaptures.path).query({ limit: 1 }).expect(200))
        .body;
      expect(page.items).toHaveLength(1);
      expect(page.metadata.next_cursor).toEqual(expect.any(String));
      const next = (
        await auth("get", routes.listCaptures.path)
          .query({ limit: 1, cursor: page.metadata.next_cursor })
          .expect(200)
      ).body;
      expect(next.items).toHaveLength(1);
      expect(new Set([page.items[0].id, next.items[0].id])).toEqual(new Set([first.id, second.id]));
      expect(next.metadata.next_cursor).toBeNull();
      expect(
        (await auth("get", routes.listCaptures.path).query({ term: " de Fiets " }).expect(200)).body
          .items[0].id,
      ).toBe(first.id);
      for (const term of ["de fietsbel", "100%_echt"])
        await auth("post", routes.createCapture.path)
          .send({ mutationId: uuidv7(), term })
          .expect(200);
      const prefixed = async (query: Record<string, string | number>) =>
        routes.listCaptures.response.parse(
          (await auth("get", routes.listCaptures.path).query(query).expect(200)).body,
        );
      expect((await prefixed({ prefix: " DE  fiets" })).items.map((item) => item.term)).toEqual([
        "de fietsbel",
        "de fiets",
      ]);
      const firstPrefixPage = await prefixed({ prefix: "de fiets", limit: 1 });
      expect(firstPrefixPage.items.map((item) => item.term)).toEqual(["de fietsbel"]);
      const secondPrefixPage = await prefixed({
        prefix: "de fiets",
        limit: 1,
        cursor: firstPrefixPage.metadata.next_cursor!,
      });
      expect(secondPrefixPage).toEqual({ items: [first], metadata: { next_cursor: null } });
      expect((await prefixed({ prefix: "100%_" })).items.map((item) => item.term)).toEqual([
        "100%_echt",
      ]);
      expect((await prefixed({ prefix: "1_0" })).items).toEqual([]);
      expect((await prefixed({ prefix: "%" })).items).toEqual([]);
      expect(
        (await auth("get", routes.getCapture.path.replace(":id", first.id)).expect(200)).body,
      ).toEqual(first);
      expect(
        (await auth("get", routes.searchEntries.path).query({ query: "fiets" }).expect(200)).body
          .items,
      ).toEqual([]);
      await auth("get", routes.studyInventory.path).expect(404);

      const deleteBody = { mutationId: uuidv7() };
      const path = routes.deleteCapture.path.replace(":id", first.id);
      expect((await auth("delete", path).send(deleteBody).expect(200)).body).toEqual(first);
      expect((await auth("delete", path).send(deleteBody).expect(200)).body).toEqual(first);
      await auth("get", routes.getCapture.path.replace(":id", first.id)).expect(404);
      await auth("delete", path).send({ mutationId: uuidv7() }).expect(404);
      await auth("get", routes.listCaptures.path).query({ cursor: "invalid" }).expect(400);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("consumes a capture atomically when an entry is created or a stub is completed", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post" | "patch", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    const capture = async (term: string) =>
      routes.createCapture.response.parse(
        (
          await auth("post", routes.createCapture.path)
            .send({ mutationId: uuidv7(), term })
            .expect(200)
        ).body,
      );
    const create = async (entry: Record<string, unknown>) =>
      routes.createEntry.response.parse(
        (
          await auth("post", routes.createEntry.path)
            .send({ mutationId: uuidv7(), entry })
            .expect(200)
        ).body,
      );
    try {
      const saved = await capture("de fiets");
      const wrong = { mutationId: uuidv7(), captureId: saved.id, entry: { lemma: "huis" } };
      await auth("post", routes.createEntry.path).send(wrong).expect(400);
      expect(
        (await auth("get", routes.lookupEntry.path).query({ term: "huis" }).expect(200)).body,
      ).toEqual([]);
      await auth("get", routes.getCapture.path.replace(":id", saved.id)).expect(200);

      const addBody = { mutationId: uuidv7(), captureId: saved.id, entry: { lemma: "de fiets" } };
      const added = (await auth("post", routes.createEntry.path).send(addBody).expect(200)).body;
      expect(added.entry).toMatchObject({ lemma: "fiets", status: "active" });
      expect((await auth("post", routes.createEntry.path).send(addBody).expect(200)).body).toEqual(
        added,
      );
      await auth("get", routes.getCapture.path.replace(":id", saved.id)).expect(404);

      await create({ lemma: "lopen", relatedTokens: ["+wandelen"] });
      const stub = (
        await auth("get", routes.lookupEntry.path).query({ term: "wandelen" }).expect(200)
      ).body[0].entry;
      expect(stub.status).toBe("stub");
      const pending = await capture("wandelen");
      const updateBody = {
        mutationId: uuidv7(),
        captureId: pending.id,
        expectedRevision: stub.revision,
        changes: { extra: "to walk" },
      };
      const updated = (
        await auth("patch", routes.updateEntry.path.replace(":id", String(stub.id)))
          .send(updateBody)
          .expect(200)
      ).body;
      expect(updated.entry).toMatchObject({
        id: stub.id,
        status: "active",
        extra: "to walk",
        relations: stub.relations,
      });
      await auth("get", routes.getCapture.path.replace(":id", pending.id)).expect(404);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
