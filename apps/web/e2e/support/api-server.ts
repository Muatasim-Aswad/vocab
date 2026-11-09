import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

const apiRoot = resolve(import.meta.dirname, "../../../api");
const webDist = resolve(import.meta.dirname, "../../dist");

const logLine = z.object({
  message: z.union([z.string(), z.object({ event: z.string(), port: z.int().optional() })]),
});

export interface ApiServer {
  baseUrl: string;
  port: number;
  /** Stops gracefully; rejects unless the API reports a clean shutdown. */
  stop(): Promise<void>;
}

export function requireBuilds() {
  for (const file of [join(apiRoot, "dist/main.js"), join(webDist, "index.html")]) {
    if (!existsSync(file)) throw new Error(`Missing ${file}: run \`vp run -r build\` first`);
  }
}

const envFor = (databasePath: string, token: string, port: number) => ({
  PATH: process.env.PATH,
  VOCAB_DATABASE_PATH: databasePath,
  VOCAB_API_TOKEN: token,
  VOCAB_BIND: "127.0.0.1",
  VOCAB_PORT: String(port),
  VOCAB_WEB_ROOT: webDist,
  VOCAB_LOG_LEVEL: "warn",
});

/** Creates the disposable database and applies the shipped migrations. */
export function migrate(databasePath: string) {
  execFileSync(process.execPath, [join(apiRoot, "dist/migrate.js")], {
    env: envFor(databasePath, "x".repeat(32), 0),
    stdio: "pipe",
  });
}

/** Starts the built API serving the built web app on loopback; port 0 picks a free port. */
export async function startApi(databasePath: string, token: string, port = 0): Promise<ApiServer> {
  const server = spawn(process.execPath, [join(apiRoot, "dist/main.js")], {
    env: { ...envFor(databasePath, token, port), VOCAB_LOG_LEVEL: "log" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const events: string[] = [];
  const exited = new Promise<number | null>((done) => server.once("exit", done));
  const listening = await new Promise<number>((started, failed) => {
    createInterface({ input: server.stdout }).on("line", (line) => {
      const { message } = logLine.parse(JSON.parse(line));
      if (typeof message === "string") return;
      events.push(message.event);
      if (message.event === "http_listening") started(message.port!);
    });
    void exited.then((code) => failed(new Error(`API exited during startup (code ${code})`)));
  });
  return {
    baseUrl: `http://127.0.0.1:${listening}`,
    port: listening,
    async stop() {
      server.kill("SIGTERM");
      const code = await exited;
      if (code !== 0 || !events.includes("shutdown_complete"))
        throw new Error(
          `API did not shut down gracefully (exit ${code}; events: ${events.join(", ")})`,
        );
    },
  };
}
