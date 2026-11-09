import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { hostName } from "./shared/host-name.js";

/** The API package root. Relative configured paths resolve against it, never the working directory. */
const packageRoot = resolve(import.meta.dirname, "..");

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

/** Treats empty variables (`KEY=` in an env file) as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const path = z
  .string()
  .trim()
  .min(1)
  .transform((value) => resolve(packageRoot, value));

const list = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const int = (min: number, fallback: number) =>
  optional(z.coerce.number().int().min(min)).default(fallback);

const storageEnv = z.object({
  VOCAB_DATABASE_PATH: optional(path).default(resolve(packageRoot, "data/vocab.db")),
});

const httpEnv = z.object({
  VOCAB_BIND: optional(z.string().trim().min(1)).default("127.0.0.1"),
  VOCAB_PORT: optional(z.coerce.number().int().min(0).max(65_535)).default(3000),
  VOCAB_API_TOKEN: z
    .string()
    .min(32, "must be at least 32 characters")
    .regex(/^[\x21-\x7E]+$/, "must be printable ASCII without spaces"),
  VOCAB_PUBLIC_ORIGIN: optional(z.string().trim().min(1)),
  VOCAB_GEMINI_API_KEY: optional(z.string().trim().min(1)),
  VOCAB_GEMINI_MODEL: optional(z.string().trim().min(1)).default("gemini-3.8-flash"),
  VOCAB_AI_TIMEOUT_MS: int(24_001, 90_000),
  VOCAB_AI_MAX_CONCURRENT: int(1, 2),
  VOCAB_HOSTS: optional(list),
  VOCAB_CORS_ORIGINS: optional(list).default([]),
  VOCAB_WEB_ROOT: optional(path),
  VOCAB_BODY_LIMIT_BYTES: int(1, 100_000),
  VOCAB_REQUEST_TIMEOUT_MS: int(1, 10_000),
  VOCAB_MAX_CONCURRENT_REQUESTS: int(1, 32),
  VOCAB_SHUTDOWN_TIMEOUT_MS: int(1, 10_000),
  VOCAB_LOG_LEVEL: optional(z.enum(["error", "warn", "log", "debug", "verbose"])).default("log"),
});

export interface StorageConfig {
  /** Absolute SQLite file path. */
  path: string;
  /** Absolute folder of shipped migrations. */
  migrationsFolder: string;
}

export interface AppConfig {
  version: string;
  logLevel: z.infer<typeof httpEnv>["VOCAB_LOG_LEVEL"];
  database: StorageConfig;
  ai: { apiKey: string | undefined; model: string; timeoutMs: number; maxConcurrent: number };
  http: {
    host: string;
    port: number;
    apiToken: string;
    /** Accepted `Host` header names, without ports. */
    allowedHosts: string[];
    /** Cross-origin browser origins; empty allows same-origin only. */
    corsOrigins: string[];
    publicOrigin: string | undefined;
    /** Built web app served by the API, when set. */
    webRoot: string | undefined;
    bodyLimitBytes: number;
    requestTimeoutMs: number;
    maxConcurrentRequests: number;
    shutdownTimeoutMs: number;
  };
}

/** Invalid configuration. Issues name variables but never echo their values. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

type Env = Record<string, string | undefined>;

const describeIssues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

function storageFrom({ VOCAB_DATABASE_PATH }: z.output<typeof storageEnv>): StorageConfig {
  return { path: VOCAB_DATABASE_PATH, migrationsFolder: resolve(packageRoot, "drizzle") };
}

/** Storage settings, shared by the server and the migration command. */
export function loadStorageConfig(env: Env = process.env): StorageConfig {
  const result = storageEnv.safeParse(env);
  if (!result.success) throw new ConfigError(describeIssues(result.error));
  return storageFrom(result.data);
}

function isLoopback(host: string) {
  const name = hostName(host);
  return loopbackHosts.includes(name) || /^127(\.\d{1,3}){3}$/.test(name);
}

function origin(value: string): string | undefined {
  try {
    return new URL(value).origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function loadConfig(env: Env = process.env): AppConfig {
  const result = storageEnv.extend(httpEnv.shape).safeParse(env);
  if (!result.success) throw new ConfigError(describeIssues(result.error));
  const http = result.data;

  const issues: string[] = [];
  if (!isLoopback(http.VOCAB_BIND) && !http.VOCAB_HOSTS?.length) {
    issues.push("VOCAB_HOSTS: required when VOCAB_BIND is not a loopback address");
  }
  for (const value of http.VOCAB_CORS_ORIGINS) {
    if (!origin(value))
      issues.push(`VOCAB_CORS_ORIGINS: "${value}" is not an origin such as https://host:port`);
  }
  if (http.VOCAB_PUBLIC_ORIGIN && !origin(http.VOCAB_PUBLIC_ORIGIN))
    issues.push("VOCAB_PUBLIC_ORIGIN: must be an origin such as https://host:port");
  if (issues.length) throw new ConfigError(issues);

  const pkg = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")));
  return {
    version: pkg.version,
    logLevel: http.VOCAB_LOG_LEVEL,
    database: storageFrom(http),
    ai: {
      apiKey: http.VOCAB_GEMINI_API_KEY,
      model: http.VOCAB_GEMINI_MODEL,
      timeoutMs: http.VOCAB_AI_TIMEOUT_MS,
      maxConcurrent: http.VOCAB_AI_MAX_CONCURRENT,
    },
    http: {
      host: http.VOCAB_BIND,
      port: http.VOCAB_PORT,
      apiToken: http.VOCAB_API_TOKEN,
      allowedHosts: [...new Set([...loopbackHosts, ...(http.VOCAB_HOSTS ?? [])].map(hostName))],
      corsOrigins: http.VOCAB_CORS_ORIGINS,
      publicOrigin: http.VOCAB_PUBLIC_ORIGIN,
      webRoot: http.VOCAB_WEB_ROOT,
      bodyLimitBytes: http.VOCAB_BODY_LIMIT_BYTES,
      requestTimeoutMs: http.VOCAB_REQUEST_TIMEOUT_MS,
      maxConcurrentRequests: http.VOCAB_MAX_CONCURRENT_REQUESTS,
      shutdownTimeoutMs: http.VOCAB_SHUTDOWN_TIMEOUT_MS,
    },
  };
}
