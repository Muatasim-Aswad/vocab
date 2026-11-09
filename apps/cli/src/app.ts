import { appCopy } from "./app-copy.ts";
import type { VocabApi } from "./infra/api.ts";
import { ConfigFileError, type CliPaths, type Preferences } from "./infra/config.ts";
import { handleAiInput, handleJsonInput } from "./modules/ai/ai.ts";
import { handleCapture, handleCaptures } from "./modules/capture/captures.ts";
import { configureStudySession } from "./modules/study/study.ts";
import { addModes, handleAddMode } from "./modules/vocabulary/add.ts";
import {
  editModeFor,
  handleDelete,
  handleEdit,
  handleList,
  handleSearch,
  handleShow,
} from "./modules/vocabulary/commands.ts";
import type { AppContext, AppMode } from "./platform/context.ts";
import { configureStyles, s, type TerminalIO } from "./platform/terminal.ts";
import { handleSettings } from "./settings.ts";
import { CliError } from "./shared/errors.ts";

type Category = keyof typeof appCopy.categories;
type Command = {
  name: string;
  aliases: string[];
  usage?: string;
  description: string;
  category: Category;
  /** Recognized only to explain the retirement; hidden from help. */
  retired?: string;
  preserveWhitespace?: boolean;
  run: (argument: string) => unknown;
};

function displayHelp(
  view: (message: string) => void,
  mode: AppMode,
  commands: readonly Command[],
): void {
  view(appCopy.helpHeading);
  for (const category of ["modes", "commands", "other"] as const) {
    view(appCopy.category(appCopy.categories[category]));
    for (const entry of commands.filter((item) => item.category === category && !item.retired)) {
      const names = [...entry.aliases, entry.name].join(" | ");
      const usage = entry.usage ? `${names} ${entry.usage}` : names;
      const description = entry.description.replace(
        /(^|[^\w-])(-{1,2}[a-zA-Z][\w-]*)/g,
        (_match, prefix: string, flag: string) => `${prefix}${s.aH(flag)}`,
      );
      view(appCopy.helpRow(s.aH(usage), description));
    }
  }
  view(appCopy.helpMode(mode));
}

export type AppOptions = {
  io: TerminalIO;
  api: VocabApi;
  paths: CliPaths;
  preferences: Preferences;
  now?: () => number;
  studyLogPolicy?: "best-effort" | "fail-fast";
  /** Loads lemma completions in the background (interactive terminals only). */
  loadSuggestions?: boolean;
};

export class CliApp {
  private mode: AppMode = "normal";
  private exited = false;
  private preferences: Preferences;
  /** A command that failed before any change was sent; an empty prompt retries it. */
  private retryable: { input: string; mode: AppMode } | null = null;
  private readonly ctx: AppContext;
  private readonly commands: Command[];
  private readonly commandByName = new Map<string, Command>();
  private readonly words = new Set<string>();

  constructor(private readonly options: AppOptions) {
    this.preferences = options.preferences;
    configureStyles({ dark: this.preferences.dark });
    this.ctx = {
      io: options.io,
      api: options.api,
      paths: options.paths,
      preferences: () => this.preferences,
      setPreferences: (next) => {
        this.preferences = next;
        configureStyles({ dark: next.dark });
      },
      now: options.now ?? Date.now,
      studyLogPolicy: options.studyLogPolicy ?? "best-effort",
    };
    this.commands = this.createCommands();
    for (const command of this.commands) {
      for (const name of new Set([command.name, ...command.aliases])) {
        if (this.commandByName.has(name)) throw new Error(`Duplicate command: ${name}`);
        this.commandByName.set(name, command);
      }
    }
  }

  private createCommands(): Command[] {
    const { io } = this.options;
    const switchTo = (mode: AppMode, message: string) => () => {
      this.mode = mode;
      io.view(message);
    };
    return [
      {
        name: "fast",
        run: switchTo("fast", appCopy.switched.fast),
        aliases: ["f"],
        description: appCopy.descriptions.fast,
        category: "modes",
      },
      {
        name: "normal",
        run: switchTo("normal", appCopy.switched.normal),
        aliases: ["n"],
        description: appCopy.descriptions.normal,
        category: "modes",
      },
      {
        name: "detail",
        run: switchTo("detail", appCopy.switched.detail),
        aliases: ["dt"],
        description: appCopy.descriptions.detail,
        category: "modes",
      },
      {
        name: "json",
        run: switchTo("json", appCopy.switched.json),
        aliases: ["j"],
        description: appCopy.descriptions.json,
        category: "modes",
      },
      {
        name: "ai",
        run: switchTo("ai", appCopy.switched.ai),
        aliases: ["ai"],
        description: appCopy.descriptions.ai,
        category: "modes",
      },
      {
        name: "searchmode",
        run: switchTo("search", appCopy.switched.search),
        aliases: ["sm"],
        description: appCopy.descriptions.searchmode,
        category: "modes",
      },
      {
        name: "delete",
        run: (argument) => handleDelete(this.ctx, argument),
        aliases: ["d"],
        usage: appCopy.usages.delete,
        description: appCopy.descriptions.delete,
        category: "commands",
      },
      {
        name: "edit",
        run: (argument) => handleEdit(this.ctx, argument, editModeFor(this.mode)),
        aliases: ["e"],
        usage: appCopy.usages.edit,
        description: appCopy.descriptions.edit,
        category: "commands",
      },
      {
        name: "list",
        run: (argument) => handleList(this.ctx, argument),
        aliases: ["ls"],
        usage: appCopy.usages.list,
        description: appCopy.descriptions.list,
        category: "commands",
      },
      {
        name: "captures",
        run: (argument) => handleCaptures(this.ctx, argument),
        aliases: ["cap"],
        usage: appCopy.usages.captures,
        description: appCopy.descriptions.captures,
        category: "commands",
      },
      {
        name: "search",
        preserveWhitespace: true,
        run: (argument) => handleSearch(this.ctx, argument),
        aliases: ["s"],
        usage: appCopy.usages.search,
        description: appCopy.descriptions.search,
        category: "commands",
      },
      {
        name: "show",
        run: (argument) => handleShow(this.ctx, argument),
        aliases: [],
        usage: appCopy.usages.show,
        description: appCopy.descriptions.show,
        category: "commands",
      },
      {
        name: "study",
        run: () => configureStudySession(this.ctx),
        aliases: ["st"],
        description: appCopy.descriptions.study,
        category: "modes",
      },
      {
        name: "help",
        run: () => displayHelp(io.view, this.mode, this.commands),
        aliases: [],
        description: appCopy.descriptions.help,
        category: "other",
      },
      {
        name: "mode",
        run: () => io.view(appCopy.mode(this.mode)),
        aliases: [],
        description: appCopy.descriptions.mode,
        category: "other",
      },
      {
        name: "quit",
        run: () => {
          io.close();
          io.clearScreen();
          this.exited = true;
        },
        aliases: ["q"],
        description: appCopy.descriptions.quit,
        category: "other",
      },
      {
        name: "quitWithDbCommit",
        run: () => io.view(s.e(appCopy.retired("quitWithDbCommit", "qw", appCopy.retiredCommit))),
        aliases: ["qw"],
        description: appCopy.descriptions.quitWithDbCommit,
        category: "other",
        retired: appCopy.retiredCommit,
      },
      {
        name: "settings",
        run: (argument) => handleSettings(this.ctx, argument),
        aliases: [],
        usage: appCopy.usages.settings,
        description: appCopy.descriptions.settings,
        category: "other",
      },
      {
        name: "clear",
        run: () => io.clearScreen(),
        aliases: [],
        description: appCopy.descriptions.clear,
        category: "other",
      },
    ];
  }

  get currentMode(): AppMode {
    return this.mode;
  }

  get hasExited(): boolean {
    return this.exited;
  }

  private modeHandler(mode: AppMode, input: string): Promise<unknown> {
    switch (mode) {
      case "fast":
        return handleCapture(this.ctx, input);
      case "normal":
      case "detail":
        return handleAddMode(this.ctx, input, addModes[mode]);
      case "json":
        return handleJsonInput(this.ctx, input);
      case "ai":
        return handleAiInput(this.ctx, input);
      case "search":
        return handleSearch(this.ctx, input);
      default:
        throw new Error("Unknown mode");
    }
  }

  private async dispatch(input: string, mode: AppMode): Promise<void> {
    const trimmed = input.trim();
    const name = trimmed.split(/\s+/)[0]!;
    const command = this.commandByName.get(name);
    if (command) {
      const rawArgument = input.slice(input.search(/\S/) + name.length);
      await command.run(command.preserveWhitespace ? rawArgument : rawArgument.trim());
      return;
    }
    await this.modeHandler(mode, mode === "search" ? input : input.trim());
  }

  /** Runs one prompt line; failures are shown and the mode and pending changes survive. */
  async processInput(rawInput: string): Promise<void> {
    const { io, api } = this.options;
    io.clearScreen();
    let input = rawInput;
    let mode = this.mode;
    if (!input.trim() && this.retryable) {
      ({ input, mode } = this.retryable);
      io.view(appCopy.retrying(input.trim()));
    }
    this.retryable = null;
    try {
      if (api.hasPending()) await api.reconcilePending();
      await this.dispatch(input, mode);
    } catch (error) {
      if (error instanceof ConfigFileError) {
        io.view(s.err(error.message));
        return;
      }
      if (!(error instanceof CliError)) throw error;
      io.view(error.message);
      if ((error.kind === "network" || error.kind === "auth") && !error.journaled && input.trim()) {
        this.retryable = { input, mode };
        io.view(appCopy.kept(input.trim()));
      }
    }
  }

  /** Checks the separately running API; never starts one. */
  async checkConnection(): Promise<boolean> {
    const { io, api } = this.options;
    try {
      await api.status();
    } catch (error) {
      if (!(error instanceof CliError || error instanceof ConfigFileError)) throw error;
      io.view(s.err(error.message));
      if (error instanceof CliError && error.kind === "network") io.view(appCopy.apiUnavailable);
      return false;
    }
    try {
      if (api.hasPending()) await api.reconcilePending();
    } catch (error) {
      if (!(error instanceof CliError || error instanceof ConfigFileError)) throw error;
      io.view(error.message);
    }
    return true;
  }

  private async loadSuggestions(): Promise<void> {
    const all = await this.options.api.page("list", {}, undefined, Number.MAX_SAFE_INTEGER, {
      operation: "list",
    });
    for (const entry of all.entries) this.words.add(entry.lemma);
  }

  async run(): Promise<number> {
    const { io } = this.options;
    io.setupCompleter([...this.commandByName.keys()], () => [...this.words]);
    io.clearScreen();
    io.view(s.aH(appCopy.heading));
    io.view(appCopy.helpHint);
    if ((await this.checkConnection()) && this.options.loadSuggestions)
      this.loadSuggestions().catch(() => {});
    while (!this.exited) {
      const prompt = appCopy.prompt(this.mode);
      const answer = this.mode === "json" ? await io.askJson(prompt) : await io.ask(prompt, true);
      await this.processInput(answer);
    }
    return 0;
  }
}
