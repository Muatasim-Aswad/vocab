import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Body, Controller, Get } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { apiErrorResponse, routes, type RouteContract } from "@vocab/contracts";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { AppConfig } from "../src/config.js";
import { Contract } from "../src/platform/http/contract.js";
import { AppError } from "../src/shared/app-error.js";
import {
  CapturingLogger,
  createTestApp,
  generateFixtureMigrations,
  tempDir,
  testConfig,
  testToken,
} from "./support.js";

const echoRoute = {
  method: "POST",
  path: "/api/test/echo",
  auth: "public",
  summary: "Fixture",
  body: z.object({ name: z.string().min(1), count: z.int().positive() }),
  response: z.object({ name: z.string(), count: z.int() }),
} as const satisfies RouteContract;

const fixture = (
  path: string,
  auth: RouteContract["auth"] = "public",
  response: z.ZodType = z.object({}),
) => ({ method: "GET", path, auth, summary: "Fixture", response }) as const satisfies RouteContract;

let release: () => void = () => {};

@Controller()
class FixtureController {
  @Contract(echoRoute)
  echo(@Body() body: z.output<typeof echoRoute.body>) {
    return { ...body, internal: "stripped" };
  }

  @Contract(fixture("/api/test/bad-response", "public", z.object({ ok: z.boolean() })))
  badResponse() {
    return { ok: "yes" };
  }

  @Contract(fixture("/api/test/crash"))
  crash() {
    throw new Error("secret crash detail");
  }

  @Contract(fixture("/api/test/app-error"))
  appError() {
    throw new AppError("conflict", {
      message: "Entry changed",
      internal: "revision mismatch 3 != 4",
      cause: new Error("db detail"),
      details: { public: { revision: 4 }, private: { owner: "private-owner" } },
    });
  }

  @Contract(fixture("/api/test/slow"))
  async slow() {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {};
  }

  @Contract(fixture("/api/test/protected", "bearer"))
  protectedRoute() {
    return {};
  }

  @Get("/api/test/uncontracted")
  uncontracted() {
    return {};
  }
}

/** Parses the body with the contract and checks the status and request ID agree. */
function expectError(res: request.Response, status: number, code: string) {
  const body = apiErrorResponse.parse(res.body);
  expect(res.status).toBe(status);
  expect(body.error).toMatchObject({ status, code });
  expect(body.error.request_id).toBe(res.headers["x-request-id"]);
  if (code !== "validation_failed") expect(body.error.issues).toBeUndefined();
  return body.error;
}

describe("HTTP API", () => {
  let dir: ReturnType<typeof tempDir>;
  let config: AppConfig;
  let app: NestExpressApplication;
  let logger: CapturingLogger;

  beforeAll(async () => {
    dir = tempDir();
    config = testConfig(dir.dir, {
      env: {
        VOCAB_REQUEST_TIMEOUT_MS: "200",
        VOCAB_BODY_LIMIT_BYTES: "1000",
        VOCAB_CORS_ORIGINS: "https://web.example",
      },
    });
    ({ app, logger } = await createTestApp(config, { controllers: [FixtureController] }));
  });

  afterAll(async () => {
    await app.close();
    dir.cleanup();
  });

  afterEach(() => {
    release();
  });

  const http = () => request(app.getHttpServer());

  describe("system routes", () => {
    it("serves liveness", async () => {
      const res = await http().get(routes.liveness.path).expect(200);
      expect(routes.liveness.response.parse(res.body)).toEqual({ status: "ok" });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("serves readiness with public checks only", async () => {
      const res = await http().get(routes.readiness.path).expect(200);
      expect(routes.readiness.response.parse(res.body)).toEqual({
        status: "ready",
        checks: { database: "ok", migrations: "ok" },
      });
      expect(JSON.stringify(res.body)).not.toContain(config.database.path);
    });

    it("rejects status without a valid token", async () => {
      for (const authorization of [
        undefined,
        "Bearer wrong-token",
        `Basic ${testToken}`,
        `Bearer ${testToken}x`,
      ]) {
        const req = http().get(routes.status.path);
        const res = await (authorization ? req.set("authorization", authorization) : req);
        expectError(res, 401, "unauthorized");
        expect(res.headers["www-authenticate"]).toBe("Bearer");
      }
    });

    it("serves status with the token", async () => {
      const res = await http()
        .get(routes.status.path)
        .set("authorization", `Bearer ${testToken}`)
        .expect(200);
      const status = routes.status.response.parse(res.body);
      expect(status).toMatchObject({
        service: "vocab-api",
        version: config.version,
        database: { applied_migrations: readdirSync(config.database.migrationsFolder).length },
      });
    });

    it("serves an OpenAPI document covering every contract route", async () => {
      const res = await http().get(routes.openapi.path).expect(200);
      expect(res.body.openapi).toBe("3.1.0");
      for (const route of Object.values(routes)) {
        expect(res.body.paths[route.path]).toHaveProperty(route.method.toLowerCase());
      }
      expect(res.body.paths[routes.status.path].get.security).toEqual([{ bearer: [] }]);
      expect(res.body.components.schemas.ApiError.properties.error).toBeDefined();
    });

    it("routes every contract to a handler", async () => {
      for (const route of Object.values(routes)) {
        const method = {
          GET: "get",
          POST: "post",
          PUT: "put",
          PATCH: "patch",
          DELETE: "delete",
        } as const;
        const path = route.path.replace(":id", "1");
        const client = http();
        const res = await client[method[route.method]](path)
          .set("authorization", `Bearer ${testToken}`)
          .set("origin", "http://127.0.0.1:3000");
        expect(res.body?.error?.message, `${route.method} ${route.path}`).not.toBe("Not found");
      }
    });
  });

  describe("errors", () => {
    it("maps unknown routes to the contract shape", async () => {
      const error = expectError(await http().get("/api/nope?token=abc"), 404, "not_found");
      expect(error.message).toBe("Not found");
      const entry = logger.requests().find((e) => e.request_id === error.request_id);
      expect(entry).toMatchObject({ path: "/api/nope", status: 404, error: { code: "not_found" } });
      expect(JSON.stringify(entry)).not.toContain("token=abc");
    });

    it("maps unknown non-API paths too", async () => {
      expectError(await http().get("/nope"), 404, "not_found");
    });

    it("returns validation issues only for validation errors", async () => {
      const res = await http().post(echoRoute.path).send({ name: "", count: "3" });
      const error = expectError(res, 400, "validation_failed");
      expect(error.issues).toEqual([
        expect.objectContaining({ path: ["body", "name"], code: "too_small" }),
        expect.objectContaining({ path: ["body", "count"], code: "invalid_type" }),
      ]);
    });

    it("validates and strips successful responses", async () => {
      const res = await http()
        .post(echoRoute.path)
        .send({ name: "a", count: 2, extra: true })
        .expect(200);
      expect(res.body).toEqual({ name: "a", count: 2 });
    });

    it("maps malformed JSON without echoing input", async () => {
      const res = await http()
        .post(echoRoute.path)
        .set("content-type", "application/json")
        .send('{"name": secret');
      const error = expectError(res, 400, "bad_request");
      expect(JSON.stringify(res.body)).not.toContain("secret");
      expect(error.message).toBe("Malformed request");
    });

    it("bounds body size", async () => {
      const res = await http()
        .post(echoRoute.path)
        .send({ name: "x".repeat(2000), count: 1 });
      expectError(res, 413, "payload_too_large");
    });

    it("hides response contract violations", async () => {
      const res = await http().get("/api/test/bad-response");
      const error = expectError(res, 500, "internal");
      expect(error.message).toBe("Internal server error");
      const entry = logger.requests().find((e) => e.request_id === error.request_id);
      expect(entry).toMatchObject({ error: { internal: "Response does not match its contract" } });
    });

    it("hides unexpected errors and logs them once with the cause", async () => {
      const res = await http().get("/api/test/crash");
      const error = expectError(res, 500, "internal");
      expect(JSON.stringify(res.body)).not.toContain("secret crash detail");
      const entries = logger.entries.filter((e) =>
        JSON.stringify(e.message).includes(error.request_id),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe("error");
      expect(JSON.stringify(entries[0])).toContain("secret crash detail");
    });

    it("sends only the public parts of an AppError", async () => {
      const error = expectError(await http().get("/api/test/app-error"), 409, "conflict");
      expect(error).toEqual({
        status: 409,
        code: "conflict",
        message: "Entry changed",
        request_id: error.request_id,
        details: { revision: 4 },
      });
      const entry = logger.requests().find((e) => e.request_id === error.request_id);
      expect(entry).toMatchObject({
        error: { internal: "revision mismatch 3 != 4", private: { owner: "private-owner" } },
      });
    });

    it("denies routes without a public contract by default", async () => {
      expectError(await http().get("/api/test/protected"), 401, "unauthorized");
      expectError(await http().get("/api/test/uncontracted"), 401, "unauthorized");
      const res = await http()
        .get("/api/test/uncontracted")
        .set("authorization", `Bearer ${testToken}`);
      expectError(res, 500, "internal");
    });

    it("times out slow handlers", async () => {
      const error = expectError(await http().get("/api/test/slow"), 503, "unavailable");
      expect(error.message).toBe("Request timed out");
    });
  });

  describe("request correlation", () => {
    it("propagates a valid incoming request ID to the header, body, and log", async () => {
      const res = await http().get("/api/nope").set("x-request-id", "client-req-42");
      expect(res.headers["x-request-id"]).toBe("client-req-42");
      expect(res.body.error.request_id).toBe("client-req-42");
      expect(logger.requests().filter((e) => e.request_id === "client-req-42")).toHaveLength(1);
    });

    it("replaces an invalid incoming request ID", async () => {
      const res = await http()
        .get(routes.liveness.path)
        .set("x-request-id", `bad id ${"x".repeat(200)}`);
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("generates one on success", async () => {
      const res = await http().get(routes.liveness.path);
      const entry = logger.requests().find((e) => e.request_id === res.headers["x-request-id"]);
      expect(entry).toMatchObject({ method: "GET", path: routes.liveness.path, status: 200 });
    });
  });

  describe("exposure", () => {
    it("rejects unexpected Host headers", async () => {
      const res = await http().get(routes.liveness.path).set("host", "evil.example");
      expectError(res, 403, "forbidden");
    });

    it("allows configured CORS origins and exposes the request ID", async () => {
      const allowed = await http().get(routes.liveness.path).set("origin", "https://web.example");
      expect(allowed.headers["access-control-allow-origin"]).toBe("https://web.example");
      expect(allowed.headers["access-control-expose-headers"]).toContain("x-request-id");
      const denied = await http().get(routes.liveness.path).set("origin", "https://evil.example");
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});

describe("HTTP API limits and readiness", () => {
  it("bounds concurrent requests", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir, {
      env: { VOCAB_MAX_CONCURRENT_REQUESTS: "1", VOCAB_REQUEST_TIMEOUT_MS: "5000" },
    });
    const { app } = await createTestApp(config, { controllers: [FixtureController] });
    await app.listen(0, "127.0.0.1");
    try {
      const slow = request(app.getHttpServer()).get("/api/test/slow");
      const pending = slow.then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expectError(await request(app.getHttpServer()).get(routes.liveness.path), 503, "unavailable");
      release();
      expect((await pending).status).toBe(200);
      await request(app.getHttpServer()).get(routes.liveness.path).expect(200);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("reports pending migrations as not ready, then ready after migrating", async () => {
    const dir = tempDir();
    const migrations = join(dir.dir, "migrations");
    generateFixtureMigrations(migrations, "--name", "notes");
    const config = testConfig(dir.dir, { migrationsFolder: migrations, migrate: false });
    const { app } = await createTestApp(config);
    try {
      const res = await request(app.getHttpServer()).get(routes.readiness.path);
      const error = expectError(res, 503, "unavailable");
      expect(error.details).toEqual({ checks: { database: "ok", migrations: "pending" } });
    } finally {
      await app.close();
    }

    testConfig(dir.dir, { migrationsFolder: migrations });
    const migrated = await createTestApp(config);
    try {
      await request(migrated.app.getHttpServer()).get(routes.readiness.path).expect(200);
      const res = await request(migrated.app.getHttpServer())
        .get(routes.status.path)
        .set("authorization", `Bearer ${testToken}`)
        .expect(200);
      expect(res.body.database.applied_migrations).toBe(1);
    } finally {
      await migrated.app.close();
      dir.cleanup();
    }
  });

  it("refuses to start without an existing database (no implicit creation)", async () => {
    const dir = tempDir();
    const config = testConfig(dir.dir);
    config.database.path = join(dir.dir, "missing.db");
    await expect(createTestApp(config)).rejects.toThrow(/run the migration command first/);
    dir.cleanup();
  });
});
