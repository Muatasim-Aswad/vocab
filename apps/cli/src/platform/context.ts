import type { VocabApi } from "../infra/api.ts";
import type { CliPaths, Preferences } from "../infra/config.ts";
import type { TerminalIO } from "./terminal.ts";

export type AppMode = "fast" | "normal" | "detail" | "json" | "ai" | "search";

/** Dependencies shared by commands and modes. */
export type AppContext = {
  io: TerminalIO;
  api: VocabApi;
  paths: CliPaths;
  preferences: () => Preferences;
  setPreferences: (next: Preferences) => void;
  now: () => number;
  /** `fail-fast` rethrows a study log failure; `best-effort` warns and continues. */
  studyLogPolicy: "best-effort" | "fail-fast";
};
