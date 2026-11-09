import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@vocab/contracts";

/**
 * The built API is started as a separate process, exactly as a user runs it.
 * `VOCAB_CLI_TEST_API_DIST` points at another build (for example a candidate API fix).
 */
const apiDist =
  process.env.VOCAB_CLI_TEST_API_DIST ??
  fileURLToPath(new URL("../../../api/dist/", import.meta.url));

export const apiToken = "cli-test-token-0123456789abcdefghijklmnop";

export async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address !== "object") throw new Error("No port");
  return address.port;
}

async function waitReady(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early:\n${output()}`);
    try {
      const response = await fetch(`${url}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not become ready:\n${output()}`);
}

export type ApiServer = {
  url: string;
  port: number;
  dir: string;
  databasePath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
};

/** Migrated disposable SQLite database plus a spawned `apps/api/dist/main.js`. */
export async function startApi(
  options: { env?: Record<string, string>; port?: number } = {},
): Promise<ApiServer> {
  const dir = mkdtempSync(join(tmpdir(), "vocab-cli-api-"));
  const databasePath = join(dir, "vocab.sqlite");
  const migrated = spawnSync(process.execPath, [join(apiDist, "migrate.js")], {
    env: { PATH: process.env.PATH, VOCAB_DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
  if (migrated.status !== 0)
    throw new Error(`Migration failed:\n${migrated.stdout}${migrated.stderr}`);
  const port = options.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = "";
  const server: ApiServer = {
    url,
    port,
    dir,
    databasePath,
    async start() {
      output = "";
      child = spawn(process.execPath, [join(apiDist, "main.js")], {
        env: {
          PATH: process.env.PATH,
          VOCAB_DATABASE_PATH: databasePath,
          VOCAB_API_TOKEN: apiToken,
          VOCAB_BIND: "127.0.0.1",
          VOCAB_PORT: String(port),
          VOCAB_LOG_LEVEL: "error",
          ...options.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      await waitReady(url, child, () => output);
    },
    async stop() {
      const running = child;
      child = null;
      if (!running || running.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        running.once("exit", () => resolve());
        running.kill("SIGTERM");
      });
    },
    async dispose() {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  await server.start();
  return server;
}

/**
 * Runs SQL against a test API's disposable database, for fault injection. It runs in a separate
 * Node process with the API package's own SQLite driver; the CLI itself never opens SQLite.
 */
export function sql(api: ApiServer, statement: string): void {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const Database = require('better-sqlite3'); const db = new Database(process.argv[1], { timeout: 5000 }); db.exec(process.argv[2]); db.close();",
      api.databasePath,
      statement,
    ],
    { cwd: join(apiDist, ".."), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`SQL failed:\n${result.stderr}`);
}

type HistoryDocument = {
  sessionId: string;
  outcome?: { status: string };
  reviews: Array<{
    id: number;
    after: { strength: number; streak: number };
    internals: { answerScore: number; answerTime: number };
  }>;
  stats: { wordsReviewed: number; noCount: number };
};

/** Every stored study-history document, oldest first, read over authenticated HTTP. */
export async function studyHistory(api: ApiServer): Promise<HistoryDocument[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Array<{ id: string }>; metadata: { next_cursor: string | null } } =
      await apiRequest(
        api,
        "GET",
        `/api/study/history?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        (value) => routes.listStudyHistory.response.parse(value),
      );
    ids.push(...page.items.map((item) => item.id));
    cursor = page.metadata.next_cursor;
  } while (cursor);
  const records = await Promise.all(
    ids.map((id) => apiRequest(api, "GET", `/api/study/history/${id}`, undefined, parseHistory)),
  );
  return records.map((record) => record.document).toReversed();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHistoryReview(value: unknown): value is HistoryDocument["reviews"][number] {
  return (
    isObject(value) &&
    typeof value.id === "number" &&
    isObject(value.after) &&
    typeof value.after.strength === "number" &&
    typeof value.after.streak === "number" &&
    isObject(value.internals) &&
    typeof value.internals.answerScore === "number" &&
    typeof value.internals.answerTime === "number"
  );
}

function isHistoryDocument(value: unknown): value is HistoryDocument {
  return (
    isObject(value) &&
    typeof value.sessionId === "string" &&
    Array.isArray(value.reviews) &&
    value.reviews.every(isHistoryReview) &&
    isObject(value.stats) &&
    typeof value.stats.wordsReviewed === "number" &&
    typeof value.stats.noCount === "number" &&
    (value.outcome === undefined ||
      (isObject(value.outcome) && typeof value.outcome.status === "string"))
  );
}

function parseHistory(value: unknown): { document: HistoryDocument } {
  assert(isObject(value) && isHistoryDocument(value.document));
  return { document: value.document };
}

export function apiRequest<T>(
  api: ApiServer,
  method: string,
  path: string,
  body: unknown,
  parse: (value: unknown) => T,
): Promise<T>;
export function apiRequest(
  api: ApiServer,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown>;
export async function apiRequest<T>(
  api: ApiServer,
  method: string,
  path: string,
  body?: unknown,
  parse?: (value: unknown) => T,
): Promise<unknown> {
  const response = await fetch(`${api.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(json)}`);
  return parse ? parse(json) : json;
}

/** Seeds synthetic entries through the real API. */
export async function seedEntry(
  api: ApiServer,
  entry: Record<string, unknown>,
  backfills: unknown[] = [],
) {
  const mutationId = uuidV7();
  return apiRequestSeed(api, mutationId, entry, backfills);
}

/** Test-side UUIDv7 (time prefix, version 7, RFC variant). */
function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function apiRequestSeed(
  api: ApiServer,
  mutationId: string,
  entry: Record<string, unknown>,
  backfills: unknown[],
) {
  return apiRequest(
    api,
    "POST",
    "/api/entries",
    {
      mutationId,
      entry: { language: "nl", ...entry },
      senseCueBackfills: backfills,
    },
    (value) => routes.createEntry.response.parse(value),
  );
}

export async function listAll(
  api: ApiServer,
): Promise<Array<{ id: number; lemma: string; senseCue?: string; status?: string }>> {
  const page = await apiRequest(api, "GET", "/api/entries?limit=100", undefined, (value) =>
    routes.listEntries.response.parse(value),
  );
  return page.items;
}

/**
 * Loopback proxy in front of the API for fault injection: requests always reach the real API,
 * and `plan` can drop the response, refuse connections or answer 401.
 */
type Rule = (request: IncomingMessage) => "forward" | "drop-response" | "unauthorized" | "refuse";
const forward: Rule = () => "forward";

export async function startProxy(target: () => string) {
  let rule: Rule = forward;
  const sockets = new Set<Socket>();
  const seen: Array<{ method: string; path: string; body: string; outcome: string }> = [];
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const outcome = rule(request);
    seen.push({ method: request.method ?? "", path: request.url ?? "", body, outcome });
    if (outcome === "refuse") {
      request.socket.destroy();
      return;
    }
    if (outcome === "unauthorized") {
      response.writeHead(401, { "content-type": "application/json", "x-request-id": "proxy" });
      response.end(
        JSON.stringify({
          error: {
            status: 401,
            code: "unauthorized",
            message: "Authentication required",
            request_id: "proxy",
          },
        }),
      );
      return;
    }
    const upstream = await fetch(`${target()}${request.url}`, {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers).filter((entry): entry is [string, string] => {
          const [key, value] = entry;
          return (
            typeof value === "string" && !["host", "connection", "content-length"].includes(key)
          );
        }),
      ),
      ...(body && { body }),
    });
    const text = await upstream.text();
    if (outcome === "drop-response") {
      request.socket.destroy();
      return;
    }
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    response.end(text);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await freePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    plan(next: Rule) {
      rule = next;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Gemini-compatible upstream on loopback; the API reaches it through `GOOGLE_GEMINI_BASE_URL`. */
export async function startFakeGemini() {
  const responses: Array<{ status: number; text: string }> = [];
  const requests: Array<{ path: string; body: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url ?? "", body: Buffer.concat(chunks).toString() });
    const next = responses.shift() ?? { status: 500, text: "no scripted response" };
    if (next.status !== 200) {
      response.writeHead(next.status, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: next.status,
            message: next.text,
            status: next.status === 503 ? "UNAVAILABLE" : "INTERNAL",
          },
        }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts: [{ text: next.text }] }, finishReason: "STOP" },
        ],
      }),
    );
  });
  const port = await freePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respond(status: number, text: string) {
      responses.push({ status, text });
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
