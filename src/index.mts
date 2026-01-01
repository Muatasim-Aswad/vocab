#!/usr/bin/env node

import { ask, s, view, setupCompleter } from "./ui/terminal.mjs";
import { VocabRepository } from "./data/repository.mjs";
import { JsonDataStore } from "./data/dataStore.mjs";
import { handleFastInput } from "./modes/addFastMode.mjs";
import { handleNormalInput } from "./modes/addNormalMode.mjs";
import { handleDetailInput } from "./modes/addDetailMode.mjs";
import { handleSearchInput } from "./modes/searchMode.mjs";
import { handleSearch } from "./commands/searchCommand.mjs";
import { handleDelete } from "./commands/deleteCommand.mjs";
import { handleEditInput } from "./commands/editCommand.mjs";
import { handleList } from "./commands/listCommand.mjs";
import { handleQuitWithCommit } from "./commands/quitWithCommitCommand.mjs";
import { configureStudySession } from "./modes/studyMode.mjs";

// Get data file path from environment variable or use default
const dataFilePath = process.env.VOCAB_DATA_PATH;

if (!dataFilePath) throw new Error("Environment variable VOCAB_DATA_PATH is not set.");

// Initialize data store and repository
const dataStore = new JsonDataStore(dataFilePath);
const repo = new VocabRepository(dataStore);

const modeHandlers = {
  fast: (input: string) => handleFastInput(input, repo),
  normal: (input: string) => handleNormalInput(input, repo),
  detail: (input: string) => handleDetailInput(input, repo),
  search: (input: string) => handleSearchInput(input, repo),
};

let currentMode: keyof typeof modeHandlers = "normal";

const commandRegistry = {
  // info & control
  help: () => displayHelp(currentMode),
  mode: () => view(`Current mode: ${currentMode.toUpperCase()}`),
  quit: () => {
    console.clear();
    process.exit(0);
  },
  quitWithDbCommit: async () => {
    await handleQuitWithCommit(dataFilePath);
  },
  // modes
  fast: () => {
    currentMode = "fast";
    view("Switched to FAST INPUT mode.");
  },
  normal: () => {
    currentMode = "normal";
    view("Switched to NORMAL INPUT mode.");
  },
  detail: () => {
    currentMode = "detail";
    view("Switched to DETAIL INPUT mode.");
  },
  searchmode: () => {
    currentMode = "search";
    view("Switched to SEARCH mode.");
  },
  // actions
  search: (argument: string) => handleSearch(argument, repo),
  delete: (argument: string) => handleDelete(argument, repo),
  edit: async (argument: string) => {
    await handleEditInput(argument, repo, currentMode);
  },
  list: (argument: string) => handleList(argument, repo),
  clear: console.clear,
  // study mode
  study: async () => await configureStudySession(repo),
};

const commandHandlers = {
  ...commandRegistry,
  // info & control
  q: commandRegistry.quit,
  qw: commandRegistry.quitWithDbCommit,
  // modes
  n: commandRegistry.normal,
  f: commandRegistry.fast,
  dt: commandRegistry.detail,
  sm: commandRegistry.searchmode,
  // actions
  s: commandRegistry.search,
  d: commandRegistry.delete,
  e: commandRegistry.edit,
  ls: commandRegistry.list,
  // study mode shortcuts
  st: commandRegistry.study,
};
const availableCommands = Object.keys(commandHandlers);

// Process user input
async function processInput(unTrimmedInput: string): Promise<void> {
  console.clear();
  const input = unTrimmedInput.trim();

  if (availableCommands.includes(input.split(" ")[0])) {
    const command = input.split(" ")[0] as keyof typeof commandRegistry;
    const argument = input.slice(command.length).trim();

    await commandHandlers[command](argument);
  } else await modeHandlers[currentMode](input);
}

// Prompt for user input
async function promptUser(): Promise<void> {
  const modeIndicator = currentMode.toUpperCase();

  const answer = await ask(`\n[${modeIndicator}] > `, true);

  await processInput(answer);
  promptUser();
}

// Main function
export async function main(): Promise<void> {
  console.clear();

  // Setup autocompleter with commands and repository
  setupCompleter(availableCommands, repo);

  view(s.aH("=== Dutch Vocabulary App ==="));
  view("Type 'help' for available commands.\n");

  promptUser();
}

main();

function displayHelp(currentMode: string): void {
  view("\n=== Dutch Vocabulary App ===");

  view("\nModes:");
  view(`${s.aH("f | fast")} :Switch to Fast Input Mode (just enter words)`);
  view(`${s.aH("n | normal")} :Switch to Normal Input Mode (word with optional fields)`);
  view(`${s.aH("dt | detail")} :Switch to Detail Input Mode (all fields with auto-defaults)`);
  view(`${s.aH("sm | searchmode")} :Switch to Search Mode (interactive search)`);

  view("\nCommands:");
  view(`${s.aH("d | delete <word>")} :Delete a specific word (or last word if no argument)`);
  view(`${s.aH("e | edit <word>")} :Edit a word's entries`);
  view(`${s.aH("ls | list  -c <cursor> -l <limit>")} :List words (defaults: cursor=1, limit=50)`);
  view(
    `${s.aH(
      "s | search [-s] <query>",
    )} :Search for words (use -s for starts with, default: contains)`,
  );

  view("\nStudy Mode:");
  view(`${s.aH("st | study")} :Start a study session with spaced repetition`);

  view("\nOther:");
  view(`${s.aH("help")} :Show this help`);
  view(`${s.aH("mode")} :Show current mode`);
  view(`${s.aH("q")} :Exit the application`);
  view(`${s.aH("qw")} :Commit db changes and exit`);
  view(`\nCurrent mode: ${currentMode.toUpperCase()}`);
}
