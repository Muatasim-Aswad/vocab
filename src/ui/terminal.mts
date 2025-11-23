import readline from "readline";
import { ansi } from "./ansi.mjs";
import type { VocabRepository } from "../data/repository.mjs";

const theme = {
  reset: ansi.reset, // Reset
  app: ansi.fg.brightBlack, // Application messages
  success: ansi.fg.green, // Success messages
  error: ansi.fg.red, // Error messages
  alert: ansi.fg.brightYellow, // Old values or highlights
  white: ansi.fg.white, // White text
  cyan: ansi.fg.cyan, // Cyan text
  accent: ansi.fgRgb(102, 255, 102), // Default color for word
  accentSecondary: ansi.fgRgb(102, 178, 255), // Default color for related words
  accentTertiary: ansi.fgRgb(153, 204, 255), // Default color for examples
};

export const s = {
  // app formatting
  a(message: string): string {
    return theme.app + message + theme.reset;
  },
  // highlighted app formatting
  aH(message: string): string {
    return theme.cyan + message + theme.app;
  },
  // old value formatting
  alert(message: string): string {
    return theme.alert + message + theme.app;
  },
  // word formatting
  w(message: string): string {
    return theme.accent + message + theme.app;
  },
  // related word formatting
  r(message: string): string {
    return theme.accentSecondary + message + theme.app;
  },
  // example formatting
  e(message: string): string {
    return theme.accentTertiary + message + theme.app;
  },
  // error formatting
  err(message: string): string {
    return theme.error + message + theme.app;
  },
};

export const view = (message: string): void => {
  console.log(s.a(message));
};

let availableCommands: string[] = [];
let repo: VocabRepository | null = null;
let isCompleterEnabled = true;

function completer(line: string): [string[], string] {
  if (!isCompleterEnabled) {
    return [[], line];
  }
  const allCompletions = [...availableCommands, ...(repo?.words || [])];
  const hits = allCompletions.filter((c) => c.startsWith(line));
  return [hits.length ? hits : allCompletions, line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer,
});

// Handle Ctrl+C
rl.on("SIGINT", () => {
  console.clear();
  rl.close();
  process.exit(0);
});

export function setupCompleter(commands: string[], repository: VocabRepository): void {
  availableCommands = commands;
  repo = repository;
}

export const ask = (question: string, isAutoComplete: boolean = false): Promise<string> => {
  return new Promise((resolve) => {
    isCompleterEnabled = isAutoComplete;
    rl.question(s.a(question), (answer) => {
      resolve(answer);
    });
  });
};

export const closeRL = (): void => {
  console.clear();
  rl.close();
};

export { theme };
