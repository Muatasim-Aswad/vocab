import { describe, expect, it } from "vite-plus/test";

import { routes } from "./routes.ts";

describe("routes", () => {
  it("serves every route under /api with a unique method and path", () => {
    const keys = Object.values(routes).map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of Object.values(routes)) expect(route.path).toMatch(/^\/api\//);
  });

  it("keeps health routes public and status protected", () => {
    expect(routes.liveness.auth).toBe("public");
    expect(routes.readiness.auth).toBe("public");
    expect(routes.status.auth).toBe("bearer");
  });

  it("validates the status body, including UTC timestamps", () => {
    const status = {
      service: "vocab-api",
      version: "0.0.0",
      started_at: "2026-09-27T18:00:00.000Z",
      server_time: "2026-09-27T18:05:00.000Z",
      database: { applied_migrations: 0 },
    };
    expect(routes.status.response.parse(status)).toEqual(status);
    expect(
      routes.status.response.safeParse({ ...status, server_time: "2026-09-27T20:05:00+02:00" })
        .success,
    ).toBe(false);
  });

  it("compatibility: contracts:routes — defines complete vocabulary, study, AI and session boundaries", () => {
    const groups = [
      [
        "searchEntries",
        "listEntries",
        "getEntry",
        "lookupEntry",
        "prepareEntry",
        "resolveForms",
        "createEntry",
        "updateEntry",
        "deleteEntry",
      ],
      [
        "studyInventory",
        "startStudy",
        "getStudy",
        "answerStudy",
        "endStudy",
        "listStudyHistory",
        "getStudyHistory",
      ],
      ["generateDraft"],
      ["login", "logout", "authState"],
    ];
    for (const group of groups) for (const key of group) expect(routes).toHaveProperty(key);
    for (const route of [
      routes.createEntry,
      routes.updateEntry,
      routes.deleteEntry,
      routes.startStudy,
      routes.answerStudy,
      routes.endStudy,
    ]) {
      expect(route.method).not.toBe("GET");
      expect("body" in route && route.body.safeParse({}).success).toBe(false);
    }
    expect(routes.getEntry.params.safeParse({ id: "3" }).success).toBe(true);
    expect(routes.getEntry.params.safeParse({ id: "-1" }).success).toBe(false);
    expect(routes.generateDraft.timeoutMs).toBeGreaterThan(24_000);
  });

  it("bounds recent searches and requires client IDs and UTC times for search history writes", () => {
    expect(routes.listRecentSearches.query.parse({})).toEqual({ limit: 20 });
    expect(routes.listRecentSearches.query.safeParse({ limit: "51" }).success).toBe(false);
    const search = {
      id: "01920000-0000-7000-8000-000000000000",
      term: "fiets",
      searchedAt: "2026-09-30T10:00:00.000Z",
    };
    expect(routes.recordSearch.body.parse(search)).toEqual(search);
    expect(
      routes.recordSearch.body.safeParse({ ...search, searchedAt: "2026-09-30T12:00:00+02:00" })
        .success,
    ).toBe(false);
    expect(routes.recordSearch.body.safeParse({ ...search, term: "" }).success).toBe(false);
    expect(
      routes.clearSearchHistory.body.safeParse({ id: search.id, clearedAt: search.searchedAt })
        .success,
    ).toBe(true);
  });

  it("compatibility: history:contracts — bounds history listing and keeps schema-v2 export fields", () => {
    expect(routes.listStudyHistory).toMatchObject({ method: "GET", auth: "either" });
    expect(routes.getStudyHistory).toMatchObject({ method: "GET", auth: "either" });
    expect(routes.listStudyHistory.query.parse({})).toEqual({ limit: 20 });
    expect(routes.listStudyHistory.query.safeParse({ limit: "101" }).success).toBe(false);
    // History IDs include legacy log IDs, not only UUIDs, and never path separators.
    expect(routes.getStudyHistory.params.safeParse({ id: "18eae214600-8" }).success).toBe(true);
    expect(routes.getStudyHistory.params.safeParse({ id: "../etc" }).success).toBe(false);
    const document = {
      schemaVersion: 2,
      sessionId: "18eae214600-8",
      startedAt: "2024-04-05T12:00:00.000Z",
      selection: { kind: "priority" },
      reviews: [{ id: 3, unknownReviewField: 1 }],
      unknownField: { kept: true },
    };
    const record = {
      id: "18eae214600-8",
      sessionId: null,
      origin: "import",
      startedAt: document.startedAt,
      endedAt: null,
      outcome: null,
      reviewCount: 1,
      recordedAt: "2026-09-28T12:00:00.000Z",
      document,
    };
    expect(routes.getStudyHistory.response.parse(record).document).toEqual(document);
    for (const invalid of [
      { ...document, schemaVersion: 1 },
      { ...document, startedAt: "2024-04-05 12:00" },
      { ...document, outcome: { status: "paused" } },
      { ...document, reviews: [{ id: 0 }] },
    ])
      expect(
        routes.getStudyHistory.response.safeParse({ ...record, document: invalid }).success,
      ).toBe(false);
  });
});
