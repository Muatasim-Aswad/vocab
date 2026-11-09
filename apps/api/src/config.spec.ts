import { isAbsolute, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ConfigError, loadConfig, loadStorageConfig } from "./config.js";

const token = "t".repeat(32);
const base = { VOCAB_API_TOKEN: token, VOCAB_DATABASE_PATH: "/tmp/vocab-config-test.db" };
const packageRoot = resolve(import.meta.dirname, "..");

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  it("applies safe local defaults", () => {
    const config = loadConfig({ VOCAB_API_TOKEN: token });
    expect(config.database.path).toBe(resolve(packageRoot, "data/vocab.db"));
    expect(config.http).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      corsOrigins: [],
      webRoot: undefined,
    });
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("requires a strong token without echoing values", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    const issues = issuesOf({ VOCAB_API_TOKEN: "short-secret" });
    expect(issues.join()).toContain("VOCAB_API_TOKEN: must be at least 32 characters");
    expect(issues.join()).not.toContain("short-secret");
  });

  it("accepts the shared root settings for a local server", () => {
    const config = loadConfig({
      VOCAB_API_TOKEN: token,
      VOCAB_BIND: "0.0.0.0",
      VOCAB_PORT: "3100",
      VOCAB_HOSTS: "Vocab.example",
      VOCAB_DATABASE_PATH: "data/shared.db",
      VOCAB_PUBLIC_ORIGIN: "https://vocab.example",
      VOCAB_CORS_ORIGINS: "https://client.example",
      VOCAB_GEMINI_API_KEY: "synthetic-key",
      VOCAB_GEMINI_MODEL: "synthetic-model",
      VOCAB_MAX_CONCURRENT_REQUESTS: "7",
    });
    expect(config.http).toMatchObject({
      host: "0.0.0.0",
      port: 3100,
      apiToken: token,
      allowedHosts: ["localhost", "127.0.0.1", "[::1]", "vocab.example"],
      publicOrigin: "https://vocab.example",
      corsOrigins: ["https://client.example"],
      maxConcurrentRequests: 7,
    });
    expect(config.database.path).toBe(resolve(packageRoot, "data/shared.db"));
    expect(config.ai).toMatchObject({ apiKey: "synthetic-key", model: "synthetic-model" });
  });

  it("treats empty variables as unset", () => {
    const config = loadConfig({
      VOCAB_API_TOKEN: token,
      VOCAB_DATABASE_PATH: "",
      VOCAB_PORT: "",
      VOCAB_HOSTS: "",
    });
    expect(config.database.path).toBe(resolve(packageRoot, "data/vocab.db"));
    expect(config.http.port).toBe(3000);
  });

  it("requires explicit allowed hosts for non-loopback binding", () => {
    expect(issuesOf({ ...base, VOCAB_BIND: "0.0.0.0" })).toEqual([
      "VOCAB_HOSTS: required when VOCAB_BIND is not a loopback address",
    ]);
    const config = loadConfig({
      ...base,
      VOCAB_BIND: "0.0.0.0",
      VOCAB_HOSTS: "Vocab.example:8443, 192.168.1.5",
    });
    expect(config.http.allowedHosts).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
      "vocab.example",
      "192.168.1.5",
    ]);
  });

  it.each(["::1", "127.0.0.2", "localhost"])("treats %s as loopback", (host) => {
    expect(loadConfig({ ...base, VOCAB_BIND: host }).http.host).toBe(host);
  });

  it("rejects CORS entries that are not origins", () => {
    expect(
      issuesOf({ ...base, VOCAB_CORS_ORIGINS: "https://ok.example,https://bad.example/path" }),
    ).toEqual([
      'VOCAB_CORS_ORIGINS: "https://bad.example/path" is not an origin such as https://host:port',
    ]);
  });
});

describe("loadStorageConfig", () => {
  it("uses the same default database for migration and server startup", () => {
    expect(loadStorageConfig({}).path).toBe(loadConfig({ VOCAB_API_TOKEN: token }).database.path);
  });

  it("uses the shared database override for migrations", () => {
    expect(loadStorageConfig({ VOCAB_DATABASE_PATH: "data/shared.db" }).path).toBe(
      resolve(packageRoot, "data/shared.db"),
    );
  });

  it("resolves relative paths against the package root, not the working directory", () => {
    const storage = loadStorageConfig({ VOCAB_DATABASE_PATH: "data/vocab.db" });
    expect(storage.path).toBe(resolve(packageRoot, "data/vocab.db"));
    expect(storage.migrationsFolder).toBe(resolve(packageRoot, "drizzle"));
    expect(isAbsolute(storage.path)).toBe(true);
  });

  it("does not need HTTP settings", () => {
    expect(() => loadStorageConfig({ VOCAB_DATABASE_PATH: "/tmp/x.db" })).not.toThrow();
  });
});
