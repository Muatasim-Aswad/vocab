import { readFileSync } from "node:fs";

import { CliApp } from "./app.ts";
import { helpText, preferencesFallback } from "./cli-copy.ts";
import { VocabApi } from "./infra/api.ts";
import {
  ConfigFileError,
  defaultPreferences,
  readConnection,
  readPreferences,
  resolvePaths,
  type Env,
} from "./infra/config.ts";
import { PendingJournal } from "./infra/journal.ts";
import { createTerminalIO, s, type TerminalIO } from "./platform/terminal.ts";

const manifest: { version: string } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export type MainOptions = {
  env?: Env;
  io?: TerminalIO;
  write?: (text: string) => void;
  fetch?: typeof fetch;
};

/** `--help`/`--version` print and exit; no arguments start the interactive client. */
export async function main(args: readonly string[], options: MainOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  if (args.includes("--help") || args.includes("-h")) {
    write(helpText);
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    write(manifest.version);
    return 0;
  }
  if (args.length > 0) {
    write(helpText);
    return 2;
  }
  const env = options.env ?? process.env;
  const io = options.io ?? createTerminalIO();
  const paths = resolvePaths(env);
  let preferences;
  try {
    preferences = readPreferences(paths);
  } catch (error) {
    if (!(error instanceof ConfigFileError)) throw error;
    io.view(s.err(preferencesFallback(error.message)));
    preferences = { ...defaultPreferences };
  }
  const api = new VocabApi({
    connection: () => readConnection(paths, env),
    connectionHint: paths.connectionFile,
    journal: new PendingJournal(paths.pendingFile),
    notify: (message) => io.view(message),
    fetch: options.fetch,
  });
  return new CliApp({
    io,
    api,
    paths,
    preferences,
    loadSuggestions: process.stdin.isTTY && !options.io,
  }).run();
}
