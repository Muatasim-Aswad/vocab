import { routes } from "@vocab/contracts";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vite-plus/test";

import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

const at = (minute: number) => `2026-09-30T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("search history HTTP operations", () => {
  it("appends searches idempotently, lists distinct recent terms, and hides searches before a clear", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    const auth = (method: "get" | "post", path: string) =>
      request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${testToken}`);
    const record = (term: string, searchedAt: string, id = uuidv7()) =>
      auth("post", routes.recordSearch.path).send({ id, term, searchedAt });
    const recent = async (limit?: number) =>
      routes.listRecentSearches.response.parse(
        (
          await auth("get", routes.listRecentSearches.path)
            .query(limit ? { limit } : {})
            .expect(200)
        ).body,
      ).terms;
    try {
      const id = uuidv7();
      const first = (await record("  de   fiets ", at(1), id).expect(200)).body;
      expect(routes.recordSearch.response.parse(first)).toEqual({
        id,
        term: "de fiets",
        searchedAt: at(1),
      });
      expect((await record("de fiets", "2026-09-30T10:01:00Z", id).expect(200)).body).toEqual(
        first,
      );
      await record("lopen", at(1), id).expect(409);

      await record("lopen", at(2)).expect(200);
      await record("DE Fiets", at(3)).expect(200);
      await record("huis", at(0)).expect(200);
      expect(await recent()).toEqual(["DE Fiets", "lopen", "huis"]);
      expect(await recent(2)).toEqual(["DE Fiets", "lopen"]);

      for (let minute = 10; minute < 35; minute++)
        await record(`woord ${minute}`, at(minute)).expect(200);
      expect(await recent()).toHaveLength(20);
      expect((await recent())[0]).toBe("woord 34");

      const clear = { id: uuidv7(), clearedAt: at(40) };
      expect(
        (await auth("post", routes.clearSearchHistory.path).send(clear).expect(200)).body,
      ).toEqual(clear);
      await auth("post", routes.clearSearchHistory.path).send(clear).expect(200);
      await auth("post", routes.clearSearchHistory.path)
        .send({ ...clear, clearedAt: at(41) })
        .expect(409);
      expect(await recent()).toEqual([]);
      // A search made offline before the clear stays hidden when it arrives later.
      await record("laat", at(39)).expect(200);
      await record("fiets", at(42)).expect(200);
      expect(await recent()).toEqual(["fiets"]);

      await record("   ", at(43)).expect(400);
      await record("toekomst", new Date(Date.now() + 10 * 60_000).toISOString()).expect(400);
      await record("offset", "2026-09-30T12:00:00+02:00").expect(400);
      await auth("get", routes.listRecentSearches.path).query({ limit: 51 }).expect(400);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
