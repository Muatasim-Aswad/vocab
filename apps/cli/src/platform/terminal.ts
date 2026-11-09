import readline from "node:readline";
import { Writable } from "node:stream";

import { editor, input as promptInput, select } from "@inquirer/prompts";
import chalk, { Chalk, type ChalkInstance } from "chalk";

import { needsMoreJsonInput } from "./json-input.ts";
import { terminalCopy } from "./terminal-copy.ts";

type ChoiceOption = { value: string; label: string; description?: string };

/** Everything the CLI reads from or writes to the terminal. Tests replace it with a script. */
export interface TerminalIO {
  /** A plain function, safe to pass around. */
  view: (message: string) => void;
  ask(question: string, isAutoComplete?: boolean): Promise<string>;
  /** `continuationPrompt === "editor"` opens an editor for multi-line JSON. */
  askJson(question: string, continuationPrompt?: string): Promise<string>;
  choose(question: string, choices: readonly ChoiceOption[]): Promise<string>;
  setupCompleter(commands: string[], getWords: () => string[]): void;
  clearScreen(): void;
  startSpinner(message: string): () => void;
  close(): void;
}

/** Thrown by prompts when the user aborts a choice or editor (Ctrl+C, Escape). */
export class PromptAbortedError extends Error {
  override readonly name = "PromptAbortedError";
  constructor() {
    super(terminalCopy.aborted);
  }
}

export function isPromptAbort(error: unknown): boolean {
  return (
    error instanceof PromptAbortedError ||
    (error instanceof Error &&
      (error.name === "ExitPromptError" || error.name === "AbortPromptError"))
  );
}

type Theme = Record<
  | "app"
  | "success"
  | "error"
  | "alert"
  | "highlight"
  | "white"
  | "cyan"
  | "accent"
  | "accentSecondary"
  | "accentTertiary",
  ChalkInstance
>;

function createTheme(dark: boolean, level: 0 | 1 | 2 | 3): Theme {
  const painter = new Chalk({ level });
  return {
    app: painter.gray,
    success: painter.green,
    error: painter.red,
    alert: dark ? painter.rgb(196, 165, 70) : painter.yellowBright,
    highlight: painter.bgBlack.white,
    white: painter.white,
    cyan: painter.cyan,
    accent: dark ? painter.rgb(90, 200, 90) : painter.rgb(102, 255, 102),
    accentSecondary: painter.rgb(102, 178, 255),
    accentTertiary: painter.rgb(153, 204, 255),
  };
}

let colorLevel = chalk.level;
let theme = createTheme(false, colorLevel);

/** Applies the `dark` preference and, for tests, a fixed color level. */
export function configureStyles(options: { dark: boolean; level?: 0 | 1 | 2 | 3 }): void {
  if (options.level !== undefined) colorLevel = options.level;
  theme = createTheme(options.dark, colorLevel);
}

/** Legacy style names: a=app, aH=heading, w/r/e=accents, err=error. */
export const s = {
  a: (message: string) => theme.app(message),
  white: (message: string) => theme.white(message),
  aH: (message: string) => theme.cyan(message),
  alert: (message: string) => theme.alert(message),
  highlight: (message: string) => theme.highlight(message),
  w: (message: string) => theme.accent(message),
  r: (message: string) => theme.accentSecondary(message),
  e: (message: string) => theme.accentTertiary(message),
  err: (message: string) => theme.error(message),
};

const promptTheme = { prefix: "" } as const;

const emptyWords = (): string[] => [];

function hasHistory(
  value: readline.Interface,
): value is readline.Interface & { history: string[] } {
  return (
    "history" in value &&
    Array.isArray(value.history) &&
    value.history.every((item: unknown) => typeof item === "string")
  );
}

/** Inquirer ends its output after each prompt; the terminal must stay open. */
class PromptOutput extends Writable {
  constructor(
    private readonly terminal: NodeJS.WritableStream & { isTTY?: boolean; columns?: number },
  ) {
    super();
  }

  get isTTY() {
    return this.terminal.isTTY;
  }

  get columns() {
    return this.terminal.columns;
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.terminal.write(chunk, callback);
  }
}

/** Readline owns command completion and piped input; Inquirer owns interactive field prompts. */
export function createTerminalIO(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream & { isTTY?: boolean; columns?: number } = process.stdout,
): TerminalIO {
  const interactive = Boolean(input.isTTY && output.isTTY);
  let commands: string[] = [];
  let getWords: () => string[] = emptyWords;
  let completerEnabled = false;
  let history: string[] = [];
  let rl: readline.Interface | null = null;
  let closing = false;
  let ended = false;
  // Lines typed ahead of a prompt (piped input) wait here instead of being lost.
  const queued: string[] = [];
  let waiting: ((line: string) => void) | null = null;

  const completer = (line: string): [string[], string] => {
    if (!completerEnabled) return [[], line];
    const all = [...commands, ...getWords()];
    const hits = all.filter((candidate) => candidate.startsWith(line));
    return [hits.length ? hits : all, line];
  };

  function ensure(): readline.Interface {
    if (rl) return rl;
    const created = readline.createInterface({
      input,
      output,
      completer,
      terminal: interactive,
      historySize: 500,
      removeHistoryDuplicates: false,
    });
    if (hasHistory(created)) created.history = [...history];
    created.on("line", (line) => {
      const resolve = waiting;
      if (resolve) {
        waiting = null;
        resolve(line);
      } else queued.push(line);
    });
    created.on("SIGINT", () => {
      const resolve = waiting;
      if (resolve) {
        waiting = null;
        output.write("\n");
        resolve("q");
      }
    });
    created.on("close", () => {
      rl = null;
      if (closing) return;
      // End of input answers the pending and every later prompt with quit.
      ended = true;
      const resolve = waiting;
      waiting = null;
      resolve?.("q");
    });
    rl = created;
    return created;
  }

  function release(): void {
    if (!rl) return;
    if (hasHistory(rl)) history = [...rl.history];
    closing = true;
    rl.close();
    closing = false;
    rl = null;
  }

  async function withPrompt<T>(
    prompt: (context: {
      input: typeof input;
      output: typeof output;
      signal: AbortSignal;
    }) => Promise<T>,
  ): Promise<T> {
    release();
    if (ended) throw new PromptAbortedError();
    const controller = new AbortController();
    const onEnd = () => {
      ended = true;
      controller.abort();
    };
    const onKeypress = (_text: string | undefined, key: readline.Key) => {
      // Ctrl+D closes readline only on an empty line; Inquirer leaves that prompt unsettled.
      if (key.ctrl && key.name === "d" && input.isPaused()) onEnd();
    };
    input.once("end", onEnd);
    try {
      const answer = prompt({ input, output: new PromptOutput(output), signal: controller.signal });
      input.on("keypress", onKeypress);
      return await answer;
    } finally {
      input.removeListener("end", onEnd);
      input.removeListener("keypress", onKeypress);
    }
  }

  function readLine(prompt: string): Promise<string> {
    const next = queued.shift();
    if (next === undefined && ended) return Promise.resolve("q");
    const active = ensure();
    active.setPrompt(prompt);
    active.prompt();
    if (next !== undefined) {
      if (!interactive) output.write(`${next}\n`);
      return Promise.resolve(next);
    }
    return new Promise((resolve) => {
      waiting = (line) => {
        if (!interactive) output.write(`${line}\n`);
        resolve(line);
      };
    });
  }

  async function readJson(question: string, continuation: string): Promise<string> {
    let text = await readLine(s.a(question));
    while (needsMoreJsonInput(text)) text = `${text}\n${await readLine(s.a(continuation))}`;
    return text;
  }

  return {
    view: (message) => output.write(`${s.a(message)}\n`),
    setupCompleter(nextCommands, words) {
      commands = nextCommands;
      getWords = words;
    },
    async ask(question, isAutoComplete = false) {
      if (interactive && !isAutoComplete && queued.length === 0) {
        try {
          return await withPrompt((context) =>
            promptInput({ message: s.a(question), theme: promptTheme }, context),
          );
        } catch (error) {
          if (isPromptAbort(error)) return "q";
          throw error;
        }
      }
      completerEnabled = isAutoComplete;
      try {
        return await readLine(s.a(question));
      } finally {
        completerEnabled = false;
      }
    },
    async askJson(question, continuationPrompt = "") {
      if (continuationPrompt === "editor" && interactive) {
        return withPrompt((context) =>
          editor({ message: s.a(question), theme: promptTheme }, context),
        );
      }
      completerEnabled = false;
      return readJson(
        question,
        continuationPrompt && continuationPrompt !== "editor"
          ? continuationPrompt
          : terminalCopy.jsonContinuation,
      );
    },
    async choose(question, choices) {
      if (interactive) {
        return withPrompt((context) =>
          select(
            {
              message: s.a(question),
              theme: promptTheme,
              choices: choices.map((choice) => ({
                name: choice.label,
                value: choice.value,
                ...(choice.description ? { description: choice.description } : {}),
              })),
            },
            context,
          ),
        );
      }
      output.write(`${s.a(question)}\n`);
      choices.forEach((choice, index) =>
        output.write(terminalCopy.option(index + 1, choice.label)),
      );
      while (true) {
        const answer = (await readLine(s.a(terminalCopy.select(choices.length)))).trim();
        const byNumber = choices[Number.parseInt(answer, 10) - 1];
        const byValue = choices.find((choice) => choice.value === answer);
        const selected = /^\d+$/.test(answer) ? byNumber : byValue;
        if (selected) return selected.value;
        if (answer === "q") throw new PromptAbortedError();
      }
    },
    clearScreen() {
      if (output.isTTY) output.write("\x1b[2J\x1b[3J\x1b[H");
    },
    startSpinner(message) {
      if (!output.isTTY) {
        output.write(`${s.a(message)}\n`);
        return () => {};
      }
      const frames = ["|", "/", "-", "\\"];
      let index = 0;
      let active = true;
      const render = () => {
        if (active) output.write(`\r${frames[index++ % frames.length]} ${message}`);
      };
      render();
      const timer = setInterval(render, 120);
      return () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
        output.write(`\r${" ".repeat(message.length + 2)}\r`);
      };
    },
    close: release,
  };
}
