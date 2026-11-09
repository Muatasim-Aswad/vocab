import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { configCopy } from "./config-copy.ts";

export const formsConflictModes = ["ask", "inferred", "provided", "manual"] as const;
export type FormsConflictMode = (typeof formsConflictModes)[number];

export type Preferences = { dark: boolean; formsConflict: FormsConflictMode };
export const defaultPreferences: Preferences = { dark: false, formsConflict: "ask" };

const defaultApiUrl = "http://127.0.0.1:3000";

export type Env = Record<string, string | undefined>;

/** Local files, all outside the repository. */
export type CliPaths = {
  /** `{ "apiUrl": "...", "token": "..." }`, created with mode 0600. */
  connectionFile: string;
  preferencesFile: string;
  /** Unconfirmed writes kept for retry with their original identity. */
  pendingFile: string;
};

export function resolvePaths(env: Env = process.env): CliPaths {
  const home = homedir();
  const configDir =
    env.VOCAB_CLI_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, ".config"), "vocab");
  const stateDir =
    env.VOCAB_CLI_STATE_DIR || join(env.XDG_STATE_HOME || join(home, ".local", "state"), "vocab");
  return {
    connectionFile: join(configDir, "cli.json"),
    preferencesFile: join(configDir, "preferences.json"),
    pendingFile: join(stateDir, "cli-pending.json"),
  };
}

/** A local file the CLI could not use; the message never includes file contents. */
export class ConfigFileError extends Error {
  override readonly name = "ConfigFileError";
}

function readJsonFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw new ConfigFileError(configCopy.readFailed(path), { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigFileError(configCopy.invalidJson(path), { cause: error });
  }
}

/** Replaces a private file atomically. */
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}

export type Connection = { apiUrl: string; token: string | undefined };

function connectionFile(paths: CliPaths): { apiUrl?: unknown; token?: unknown } {
  const value = readJsonFile(paths.connectionFile);
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConfigFileError(configCopy.expectedObject(paths.connectionFile));
  return value;
}

/** Environment (`VOCAB_API_URL`, `VOCAB_API_TOKEN`) overrides the connection file. */
export function readConnection(paths: CliPaths, env: Env = process.env): Connection {
  const file = connectionFile(paths);
  const apiUrl =
    env.VOCAB_API_URL || (typeof file.apiUrl === "string" && file.apiUrl) || defaultApiUrl;
  const token = env.VOCAB_API_TOKEN || (typeof file.token === "string" ? file.token : undefined);
  return { apiUrl: apiUrl.replace(/\/+$/, ""), token: token?.trim() || undefined };
}

export function writeApiUrl(paths: CliPaths, apiUrl: string): void {
  writePrivateJson(paths.connectionFile, { ...connectionFile(paths), apiUrl });
}

const isFormsConflictMode = (value: unknown): value is FormsConflictMode =>
  (formsConflictModes as readonly unknown[]).includes(value);

export function readPreferences(paths: CliPaths): Preferences {
  const value = readJsonFile(paths.preferencesFile);
  if (value === undefined) return { ...defaultPreferences };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConfigFileError(configCopy.expectedObject(paths.preferencesFile));
  return {
    dark: "dark" in value && typeof value.dark === "boolean" ? value.dark : defaultPreferences.dark,
    formsConflict:
      "formsConflict" in value && isFormsConflictMode(value.formsConflict)
        ? value.formsConflict
        : defaultPreferences.formsConflict,
  };
}

export function writePreferences(paths: CliPaths, preferences: Preferences): void {
  writePrivateJson(paths.preferencesFile, preferences);
}
