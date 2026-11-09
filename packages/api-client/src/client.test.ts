import { describe, expect, it, vi } from "vite-plus/test";

import { createApiClient } from "./client.ts";
import { ApiError, ApiNetworkError, ApiResponseError } from "./errors.ts";

const checks = { database: "ok", migrations: "ok" } as const;
const status = {
  service: "vocab-api",
  version: "0.0.0",
  started_at: "2026-09-27T18:00:00.000Z",
  server_time: "2026-09-27T18:05:00.000Z",
  database: { applied_migrations: 0 },
};

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-request-id", "req-1");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorBody(httpStatus: number, code: string, extra: Record<string, unknown> = {}) {
  return { error: { status: httpStatus, code, message: "Failed", request_id: "req-1", ...extra } };
}

function clientReturning(response: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  return { fetch, client: createApiClient({ baseUrl: "http://api.test", fetch }) };
}

describe("createApiClient", () => {
  it("requests the contract path and returns the parsed body", async () => {
    const { fetch, client } = clientReturning(json({ status: "ok" }));
    await expect(client.liveness()).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/api/health/live",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends the token only in the Authorization header", async () => {
    const { fetch, client } = clientReturning(json(status));
    await expect(client.status({ token: "secret-token" })).resolves.toEqual(status);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).not.toContain("secret-token");
    expect(init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
  });

  it("strips fields outside the contract", async () => {
    const { client } = clientReturning(json({ ...status, internal: "x" }));
    await expect(client.status({ token: "t" })).resolves.not.toHaveProperty("internal");
  });

  it("throws ApiError for a contract error body", async () => {
    const { client } = clientReturning(json(errorBody(401, "unauthorized"), { status: 401 }));
    const error = await client.status({ token: "wrong" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "unauthorized",
      requestId: "req-1",
      message: "Failed",
    });
  });

  it("exposes reasons independently of wording, including future reasons", async () => {
    const { client } = clientReturning(
      json(errorBody(409, "conflict", { reason: "FUTURE_REASON", message: "Changed wording" }), {
        status: 409,
      }),
    );
    await expect(client.liveness()).rejects.toMatchObject({
      reason: "FUTURE_REASON",
      message: "Changed wording",
    });
  });

  it("exposes validation issues", async () => {
    const issues = [{ path: ["name"], message: "Required" }];
    const { client } = clientReturning(
      json(errorBody(400, "validation_failed", { issues }), { status: 400 }),
    );
    await expect(client.liveness()).rejects.toMatchObject({ code: "validation_failed", issues });
  });

  it.each([
    ["a success body failing its schema", json({ status: "maybe" })],
    ["a non-JSON body", new Response("<html>Bad gateway</html>", { status: 502 })],
    ["a non-contract error body", json({ message: "Not Found", statusCode: 404 }, { status: 404 })],
    [
      "an error body whose status disagrees with HTTP",
      json(errorBody(400, "bad_request"), { status: 500 }),
    ],
  ])("throws ApiResponseError for %s", async (_, response) => {
    const { client } = clientReturning(response);
    const error = await client.liveness().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error).toMatchObject({ status: response.status });
  });

  it("keeps the header request ID on malformed responses", async () => {
    const { client } = clientReturning(json({ status: "maybe" }));
    await expect(client.liveness()).rejects.toMatchObject({ requestId: "req-1" });
  });

  it("wraps network failures", async () => {
    const { client } = clientReturning(new TypeError("fetch failed"));
    await expect(client.liveness()).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it("rethrows aborts unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    const { client } = clientReturning(abort);
    await expect(client.liveness({ signal: controller.signal })).rejects.toBe(abort);
  });

  it("defaults to same-origin paths", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(json({ status: "ok" })));
    await createApiClient({ fetch }).liveness();
    expect(fetch.mock.calls[0]![0]).toBe("/api/health/live");
  });
});

describe("readiness", () => {
  it("resolves ready", async () => {
    const { client } = clientReturning(json({ status: "ready", checks }));
    await expect(client.readiness()).resolves.toEqual({ ready: true, checks });
  });

  it("resolves not ready for the 503 readiness failure", async () => {
    const failed = { database: "ok", migrations: "pending" };
    const { client } = clientReturning(
      json(errorBody(503, "unavailable", { details: { checks: failed } }), { status: 503 }),
    );
    await expect(client.readiness()).resolves.toEqual({
      ready: false,
      checks: failed,
      requestId: "req-1",
    });
  });

  it("throws other errors", async () => {
    const { client } = clientReturning(json(errorBody(503, "unavailable"), { status: 503 }));
    await expect(client.readiness()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("complete API client", () => {
  it("compatibility: client:methods — exposes a method for every shared route", async () => {
    const { routes } = await import("@vocab/contracts");
    const { client } = clientReturning(json({ authenticated: true }));
    expect(Object.keys(client).toSorted()).toEqual(Object.keys(routes).toSorted());
  });

  it("serializes query, path and mutation body while validating responses", async () => {
    const result = {
      entry: {
        id: 5,
        revision: 1,
        lemma: "fiets",
        language: "nl",
        meta: { addedAt: "2026-09-27T00:00:00.000Z", modifiedAt: "2026-09-27T00:00:00.000Z" },
      },
      relations: [],
      siblings: [],
    };
    const { fetch, client } = clientReturning(json(result));
    await expect(
      client.updateEntry(
        5,
        {
          mutationId: "0199b5aa-1d0c-7000-8000-000000000000",
          expectedRevision: 1,
          changes: { extra: "bicycle" },
        },
        { token: "secret" },
      ),
    ).resolves.toEqual(result);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/entries/5");
    expect(init).toMatchObject({ method: "PATCH", credentials: "same-origin" });
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      expectedRevision: 1,
      changes: { extra: "bicycle" },
    });
    expect(init?.headers).toMatchObject({
      authorization: "Bearer secret",
      "content-type": "application/json",
    });
  });

  it("compatibility: history:client — lists and exports stored study history with every historical field", async () => {
    const document = {
      schemaVersion: 2,
      sessionId: "18eae214600-8",
      startedAt: "2024-04-05T12:00:00.000Z",
      endedAt: "2024-04-05T12:00:01.000Z",
      selection: { kind: "priority", maxWords: 2 },
      sortResult: [{ id: 7, term: "het huis", priority: 0.75 }],
      reviews: [{ id: 9, term: "verdwenen", legacyInternals: { speed: 1 } }],
      outcome: { status: "error", message: "interrupted" },
      legacyField: true,
    };
    const summary = {
      id: "18eae214600-8",
      sessionId: null,
      origin: "import",
      startedAt: document.startedAt,
      endedAt: document.endedAt,
      outcome: "error",
      reviewCount: 1,
      recordedAt: "2026-09-28T12:00:00.000Z",
    };
    const listed = clientReturning(json({ items: [summary], metadata: { next_cursor: "c2" } }));
    await expect(
      listed.client.listStudyHistory({ limit: 1, cursor: "c1" }, { token: "t" }),
    ).resolves.toEqual({ items: [summary], metadata: { next_cursor: "c2" } });
    expect(listed.fetch.mock.calls[0]![0]).toBe(
      "http://api.test/api/study/history?limit=1&cursor=c1",
    );
    const exported = clientReturning(json({ ...summary, document }));
    await expect(exported.client.getStudyHistory("18eae214600-8", { token: "t" })).resolves.toEqual(
      {
        ...summary,
        document,
      },
    );
    expect(exported.fetch.mock.calls[0]![0]).toBe(
      "http://api.test/api/study/history/18eae214600-8",
    );
    const invalid = clientReturning(
      json({ ...summary, document: { ...document, schemaVersion: 1 } }),
    );
    await expect(invalid.client.getStudyHistory("18eae214600-8")).rejects.toBeInstanceOf(
      ApiResponseError,
    );
  });
});
