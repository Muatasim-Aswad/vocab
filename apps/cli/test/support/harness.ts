import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliApp } from "../../src/app.ts";
import { VocabApi } from "../../src/infra/api.ts";
import { readPreferences, resolvePaths, type Connection } from "../../src/infra/config.ts";
import { PendingJournal } from "../../src/infra/journal.ts";
import { configureStyles, type TerminalIO } from "../../src/platform/terminal.ts";

type ChoiceOption = Parameters<TerminalIO["choose"]>[1][number];
import { apiToken, type ApiServer } from "./api-server.ts";

/** A scripted reply; a function can inspect the prompt or advance the test clock first. */
export type Answer = string | ((prompt: string) => string);

/** Deterministic terminal: answers come from a script; every prompt and line is recorded. */
export class ScriptedTerminal implements TerminalIO {
  readonly output: string[] = [];
  readonly prompts: string[] = [];
  private readonly answers: Answer[] = [];
  /** Answers for optional prompts (for example inferred forms) that do not consume the script. */
  readonly optional: Array<[RegExp, string]> = [];
  clears = 0;

  queue(...answers: Answer[]): void {
    this.answers.push(...answers);
  }

  get remaining(): readonly Answer[] {
    return this.answers;
  }

  private next(prompt: string): string {
    this.prompts.push(prompt);
    this.output.push(prompt);
    const fallback = this.optional.find(([pattern]) => pattern.test(prompt));
    const scripted = fallback ? fallback[1] : this.answers.shift();
    if (scripted === undefined)
      throw new Error(`Unscripted prompt: ${JSON.stringify(prompt)}\n${this.text()}`);
    const answer = typeof scripted === "function" ? scripted(prompt) : scripted;
    this.output.push(`> ${answer}`);
    return answer;
  }

  // The CLI passes `view` around as a plain function.
  view = (message: string): void => {
    this.output.push(message);
  };
  async ask(question: string): Promise<string> {
    return this.next(question);
  }
  async askJson(question: string): Promise<string> {
    return this.next(question);
  }
  async choose(question: string, choices: readonly ChoiceOption[]): Promise<string> {
    const answer = this.next(
      `${question} [${choices.map((choice) => `${choice.value}=${choice.label}`).join(" | ")}]`,
    );
    if (!choices.some((choice) => choice.value === answer))
      throw new Error(`Invalid scripted choice ${answer} for ${question}`);
    return answer;
  }
  setupCompleter(): void {}
  clearScreen(): void {
    this.clears += 1;
  }
  startSpinner(message: string): () => void {
    this.output.push(message);
    return () => {};
  }
  close(): void {}

  text(): string {
    return this.output.join("\n");
  }

  /** Output recorded since `mark`. */
  since(mark: number): string {
    return this.output.slice(mark).join("\n");
  }
}

export type Harness = {
  io: ScriptedTerminal;
  app: CliApp;
  api: VocabApi;
  connection: Connection;
  paths: ReturnType<typeof resolvePaths>;
  clock: { now: number };
  /** Processes one prompt line with scripted answers; returns the output it produced. */
  run(input: string, ...answers: Answer[]): Promise<string>;
  dispose(): void;
};

export function createHarness(
  server: Pick<ApiServer, "url">,
  options: { apiUrl?: string; token?: string; studyLogPolicy?: "best-effort" | "fail-fast" } = {},
): Harness {
  configureStyles({ dark: false, level: 0 });
  const dir = mkdtempSync(join(tmpdir(), "vocab-cli-state-"));
  const paths = resolvePaths({
    VOCAB_CLI_CONFIG_DIR: join(dir, "config"),
    VOCAB_CLI_STATE_DIR: join(dir, "state"),
  });
  const connection: Connection = {
    apiUrl: options.apiUrl ?? server.url,
    token: options.token ?? apiToken,
  };
  const io = new ScriptedTerminal();
  const clock = { now: Date.parse("2024-04-05T12:00:00.000Z") };
  const api = new VocabApi({
    connection: () => connection,
    connectionHint: paths.connectionFile,
    journal: new PendingJournal(paths.pendingFile),
    notify: (message) => io.view(message),
    retryDelaysMs: [20, 20],
    requestTimeoutMs: 5000,
  });
  const app = new CliApp({
    io,
    api,
    paths,
    preferences: readPreferences(paths),
    now: () => clock.now,
    studyLogPolicy: options.studyLogPolicy,
  });
  return {
    io,
    app,
    api,
    connection,
    paths,
    clock,
    async run(input, ...answers) {
      const mark = io.output.length;
      io.queue(...answers);
      await app.processInput(input);
      if (io.remaining.length > 0)
        throw new Error(
          `Unused scripted answers ${JSON.stringify(io.remaining)}:\n${io.since(mark)}`,
        );
      return io.since(mark);
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
