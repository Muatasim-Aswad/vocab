import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LoggerService, Type } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { Database } from "../src/infra/db/database.js";
import { configureHttpApp } from "../src/platform/http/configure.js";

const packageRoot = resolve(import.meta.dirname, "..");

/** Generates migrations for the fixture schema into `out` with drizzle-kit. */
export function generateFixtureMigrations(out: string, ...args: string[]): void {
  const schema = join(packageRoot, "test/fixtures/notes.schema.ts");
  execFileSync(
    join(packageRoot, "node_modules/.bin/drizzle-kit"),
    ["generate", "--dialect", "sqlite", "--schema", schema, "--out", out, ...args],
    { cwd: packageRoot, stdio: "pipe" },
  );
}

export const testToken = "test-token-0123456789abcdef0123456789";

/** Unique temporary directory, removed by the returned cleanup. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vocab-api-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Config for a disposable database in `dir`, migrated with `migrationsFolder` unless `migrate` is false. */
export function testConfig(
  dir: string,
  {
    env = {},
    migrationsFolder,
    migrate = true,
  }: { env?: Record<string, string>; migrationsFolder?: string; migrate?: boolean } = {},
): AppConfig {
  const config = loadConfig({
    VOCAB_API_TOKEN: testToken,
    VOCAB_DATABASE_PATH: join(dir, "test.db"),
    ...env,
  });
  if (migrationsFolder) config.database.migrationsFolder = migrationsFolder;
  const database = new Database({ ...config.database, create: true });
  if (migrate) database.migrate();
  database.close();
  return config;
}

/** Collects structured log entries. */
export class CapturingLogger implements LoggerService {
  readonly entries: { level: string; message: unknown }[] = [];
  log(message: unknown) {
    this.entries.push({ level: "log", message });
  }
  error(message: unknown) {
    this.entries.push({ level: "error", message });
  }
  warn(message: unknown) {
    this.entries.push({ level: "warn", message });
  }
  debug() {}
  verbose() {}
  fatal(message: unknown) {
    this.entries.push({ level: "fatal", message });
  }

  /** `http_request` entries. */
  requests(): Record<string, unknown>[] {
    return this.entries
      .map((entry) => entry.message)
      .filter(
        (message): message is Record<string, unknown> =>
          typeof message === "object" &&
          message !== null &&
          "event" in message &&
          message.event === "http_request",
      );
  }
}

/** The production HTTP app, plus optional fixture controllers. */
export async function createTestApp(
  config: AppConfig,
  {
    controllers = [],
    logger = new CapturingLogger(),
    overrides = [],
  }: {
    controllers?: Type[];
    logger?: CapturingLogger;
    overrides?: { token: symbol; value: unknown }[];
  } = {},
) {
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers,
  });
  for (const override of overrides)
    builder.overrideProvider(override.token).useValue(override.value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger,
    bodyParser: false,
  });
  configureHttpApp(app, { version: config.version, ...config.http }, logger);
  await app.init();
  return { app, logger };
}
