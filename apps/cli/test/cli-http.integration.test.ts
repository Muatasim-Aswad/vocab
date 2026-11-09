import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@vocab/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  apiRequest,
  apiToken,
  freePort,
  seedEntry,
  startApi,
  startProxy,
  type ApiServer,
} from "./support/api-server.ts";

/** The installable artifact built by `pnpm --filter @vocab/cli build`. */
const cliBin = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const lookup = (server: ApiServer, term: string) =>
  apiRequest(
    server,
    "GET",
    `/api/entries/lookup?term=${encodeURIComponent(term)}`,
    undefined,
    (value) => routes.lookupEntry.response.parse(value),
  );
const captured = async (server: ApiServer, term: string) =>
  (
    await apiRequest(
      server,
      "GET",
      `/api/captures?term=${encodeURIComponent(term)}`,
      undefined,
      (value) => routes.listCaptures.response.parse(value),
    )
  ).items;

function mutationId(value: unknown): string {
  assert(
    value &&
      typeof value === "object" &&
      "mutationId" in value &&
      typeof value.mutationId === "string",
  );
  return value.mutationId;
}

/** A spawned CLI driven through stdin/stdout, waiting for each expected output before typing. */
class CliSession {
  private readonly child: ChildProcess;
  output = "";
  private cursor = 0;
  private readonly exited: Promise<number | null>;

  constructor(
    readonly dirs: { config: string; state: string },
    env: Record<string, string>,
  ) {
    this.child = spawn(process.execPath, [cliBin], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dirs.config,
        VOCAB_CLI_CONFIG_DIR: dirs.config,
        VOCAB_CLI_STATE_DIR: dirs.state,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
    this.child.stderr!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
    this.exited = new Promise((resolve) => this.child.once("exit", (code) => resolve(code)));
  }

  /** Waits for `pattern` after the previous match and returns the text in between. */
  async expect(pattern: string | RegExp, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rest = this.output.slice(this.cursor);
      const index = typeof pattern === "string" ? rest.indexOf(pattern) : rest.search(pattern);
      if (index !== -1) {
        const length =
          typeof pattern === "string" ? pattern.length : rest.match(pattern)![0].length;
        this.cursor += index + length;
        return rest.slice(0, index + length);
      }
      if (this.child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `Expected ${String(pattern)} in CLI output:\n${this.output.slice(this.cursor)}\n--- full ---\n${this.output}`,
    );
  }

  send(line: string): void {
    this.child.stdin!.write(`${line}\n`);
  }

  async exit(): Promise<number | null> {
    return this.exited;
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}

const cleanup: Array<() => unknown> = [];
function tempDirs() {
  const root = mkdtempSync(join(tmpdir(), "vocab-cli-bin-"));
  const dirs = { config: join(root, "config"), state: join(root, "state") };
  mkdirSync(dirs.config, { recursive: true });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return dirs;
}
function session(dirs: { config: string; state: string }, env: Record<string, string>): CliSession {
  const created = new CliSession(dirs, env);
  cleanup.push(() => created.kill());
  return created;
}

let api: ApiServer;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  await api?.dispose();
});

describe("built CLI over HTTP", () => {
  it("prints help and version from the installable bin without contacting a server", () => {
    const help = spawnSync(process.execPath, [cliBin, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: vocab [--help | --version]");
    expect(help.stdout).toContain("VOCAB_API_TOKEN");
    const version = spawnSync(process.execPath, [cliBin, "--version"], { encoding: "utf8" });
    expect(version.stdout.trim()).toBe(
      JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version,
    );
  });

  it("compatibility: cli:http", async () => {
    const seeded = await seedEntry(api, {
      lemma: "de gedeelde",
      partOfSpeech: "NOUN",
      examples: ["Van de API."],
    });
    const dirs = tempDirs();
    const cli = session(dirs, { VOCAB_API_URL: api.url, VOCAB_API_TOKEN: apiToken });
    await cli.expect("Type 'help' for available commands.");
    await cli.expect("[NORMAL] > ");
    cli.send(`show ${seeded.entry.id}`);
    expect(await cli.expect("[NORMAL] > ")).toContain("Van de API.");
    cli.send("f");
    await cli.expect("[FAST] > ");
    cli.send("httpwoord");
    expect(await cli.expect("[FAST] > ")).toContain('Captured "httpwoord" for later review.');
    expect(await captured(api, "httpwoord")).toHaveLength(1);
    expect(await lookup(api, "httpwoord")).toEqual([]);
    cli.send("list");
    const listed = await cli.expect("[FAST] > ");
    expect(listed).toContain("de gedeelde");
    expect(listed).not.toContain("httpwoord");
    cli.send("captures");
    expect(await cli.expect("[FAST] > ")).toContain("httpwoord");
    cli.send("s gedeelde");
    expect(await cli.expect("[FAST] > ")).toContain('Terms matching "gedeelde"');
    expect(
      (
        await apiRequest(api, "GET", "/api/search-history", undefined, (value) =>
          routes.listRecentSearches.response.parse(value),
        )
      ).terms,
    ).toContain("gedeelde");
    cli.send("q");
    expect(await cli.exit()).toBe(0);
    expect(cli.output).not.toContain(apiToken);
    expect(existsSync(join(dirs.state, "cli-pending.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dirs.state, "cli-pending.json"), "utf8"))).toEqual([]);
  });

  it("compatibility: cli:unavailable", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const cli = session(tempDirs(), { VOCAB_API_URL: url, VOCAB_API_TOKEN: apiToken });
    await cli.expect(`Cannot reach the vocab API at ${url}.`);
    await cli.expect("nothing was started locally");
    cli.send("sm");
    await cli.expect("[SEARCH] > ");
    cli.send("beschikbaar");
    const failed = await cli.expect("[SEARCH] > ");
    expect(failed).toContain(`Cannot reach the vocab API at ${url}.`);
    expect(failed).toContain(
      'Your input was kept. Press Enter on an empty prompt to retry "beschikbaar".',
    );
    const late = await startApi({ port });
    cleanup.push(() => late.dispose());
    await seedEntry(late, { lemma: "beschikbaar" });
    cli.send("");
    const retried = await cli.expect("[SEARCH] > ");
    expect(retried).toContain('Retrying "beschikbaar"...');
    expect(retried).toContain('=== Terms matching "beschikbaar"');
    cli.send("q");
    expect(await cli.exit()).toBe(0);
  });

  it("compatibility: cli:lost-response", async () => {
    const proxy = await startProxy(() => api.url);
    cleanup.push(() => proxy.close());
    const creates = () =>
      proxy.seen.filter((request) => request.method === "POST" && request.path === "/api/captures");
    let dropped = false;
    proxy.plan((request) => {
      if (request.method !== "POST" || request.url !== "/api/captures" || dropped) return "forward";
      dropped = true;
      return "drop-response";
    });
    const dirs = tempDirs();
    const cli = session(dirs, { VOCAB_API_URL: proxy.url, VOCAB_API_TOKEN: apiToken });
    await cli.expect("[NORMAL] > ");
    cli.send("f");
    await cli.expect("[FAST] > ");
    cli.send("verloren");
    expect(await cli.expect("[FAST] > ")).toContain('Captured "verloren" for later review.');
    const first = creates();
    expect(first).toHaveLength(2);
    expect(first.map((request) => request.outcome)).toEqual(["drop-response", "forward"]);
    expect(JSON.parse(first[1]!.body)).toEqual(JSON.parse(first[0]!.body));
    expect(await captured(api, "verloren")).toHaveLength(1);

    // Applied, response lost, then the API stays unreachable: the write survives a restart.
    const before = creates().length;
    let stage: "drop" | "refuse" | "forward" = "drop";
    proxy.plan((request) => {
      if (request.method !== "POST" || request.url !== "/api/captures") return "forward";
      if (stage === "drop") {
        stage = "refuse";
        return "drop-response";
      }
      return stage;
    });
    cli.send("verloren-twee");
    const kept = await cli.expect("[FAST] > ");
    expect(kept).toContain(
      'The change "capture "verloren-twee"" was not confirmed; it was kept and will be retried with the same identity.',
    );
    expect(kept).not.toContain("Your input was kept");
    const pending: unknown = JSON.parse(readFileSync(join(dirs.state, "cli-pending.json"), "utf8"));
    assert(Array.isArray(pending));
    const pendingId = mutationId(pending[0]);
    expect(pending).toHaveLength(1);
    cli.send("q");
    expect(await cli.exit()).toBe(0);
    stage = "forward";
    const restarted = session(dirs, { VOCAB_API_URL: proxy.url, VOCAB_API_TOKEN: apiToken });
    await restarted.expect('Confirmed pending change: capture "verloren-twee".');
    await restarted.expect("[NORMAL] > ");
    const attempts = creates().slice(before);
    expect(attempts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(attempts.map((request) => mutationId(JSON.parse(request.body))))).toEqual(
      new Set([pendingId]),
    );
    expect(await captured(api, "verloren-twee")).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dirs.state, "cli-pending.json"), "utf8"))).toEqual([]);
    restarted.send("q");
    expect(await restarted.exit()).toBe(0);
  });

  it("compatibility: cli:auth-failure", async () => {
    const dirs = tempDirs();
    const connectionFile = join(dirs.config, "cli.json");
    writeFileSync(
      connectionFile,
      JSON.stringify({ apiUrl: api.url, token: "wrong-token-000000000000000000000000" }),
    );
    const cli = session(dirs, {});
    await cli.expect(`The vocab API at ${api.url} rejected the configured token.`);
    await cli.expect("[NORMAL] > ");
    await seedEntry(api, { lemma: "authwoord" });
    cli.send("s authwoord");
    const rejected = await cli.expect("[NORMAL] > ");
    expect(rejected).toContain("rejected the configured token");
    expect(rejected).toContain(
      'Your input was kept. Press Enter on an empty prompt to retry "s authwoord".',
    );
    cli.send("f");
    await cli.expect("[FAST] > ");
    cli.send("authvangst");
    expect(await cli.expect("[FAST] > ")).toContain(
      'The change "capture "authvangst"" was kept and will be sent once the token is accepted.',
    );
    expect(await captured(api, "authvangst")).toEqual([]);
    writeFileSync(connectionFile, JSON.stringify({ apiUrl: api.url, token: apiToken }));
    cli.send("");
    const retried = await cli.expect("[FAST] > ");
    expect(retried).toContain('Confirmed pending change: capture "authvangst".');
    expect(await captured(api, "authvangst")).toHaveLength(1);
    cli.send("s authwoord");
    expect(await cli.expect("[FAST] > ")).toContain('Terms matching "authwoord"');
    cli.send("q");
    expect(await cli.exit()).toBe(0);
    expect(cli.output).not.toContain(apiToken);

    // A write rejected for authentication is kept and sent once the token works again.
    const proxy = await startProxy(() => api.url);
    cleanup.push(() => proxy.close());
    let refused = false;
    proxy.plan((request) => {
      if (request.method !== "POST" || request.url !== "/api/captures" || refused) return "forward";
      refused = true;
      return "unauthorized";
    });
    writeFileSync(connectionFile, JSON.stringify({ apiUrl: proxy.url, token: apiToken }));
    const writer = session(dirs, {});
    await writer.expect("[NORMAL] > ");
    writer.send("f");
    await writer.expect("[FAST] > ");
    writer.send("authschrijf");
    expect(await writer.expect("[FAST] > ")).toContain(
      'The change "capture "authschrijf"" was kept and will be sent once the token is accepted.',
    );
    writer.send("captures -l 1");
    const confirmed = await writer.expect("[FAST] > ");
    expect(confirmed).toContain('Confirmed pending change: capture "authschrijf".');
    expect(confirmed).toContain("1. authschrijf");
    expect(await captured(api, "authschrijf")).toHaveLength(1);
    writer.send("q");
    expect(await writer.exit()).toBe(0);
  });
});
