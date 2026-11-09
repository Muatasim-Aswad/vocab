import type { EntryChanges } from "../../infra/api.ts";
import { parseListArgs, parseSearchInput, type ParsedSearch } from "../../platform/args.ts";
import type { AppContext, AppMode } from "../../platform/context.ts";
import { renderTable } from "../../platform/table.ts";
import { isPromptAbort, PromptAbortedError, s } from "../../platform/terminal.ts";
import { CliError, legacyCodeOf } from "../../shared/errors.ts";
import { deleteCopy, editCopy, listCopy, searchCopy, showCopy } from "./commands-copy.ts";
import { inferenceFor, resolveTarget, showEntry } from "./context.ts";
import { parseJsonDefaults, type PromptDefaults } from "./json-input.ts";
import { promptTermFields, type Include, type PromptResult } from "./prompter.ts";
import { displayWords } from "./render.ts";

export async function handleList(ctx: AppContext, args: string): Promise<void> {
  const { view } = ctx.io;
  const parsed = parseListArgs(args);
  for (const warning of parsed.warnings) view(s.w(warning));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) view(s.e(error));
    return;
  }
  const { cursor, limit, typeFilter, showExtra } = parsed.value;
  const page = await ctx.api.page("list", { typeFilter }, cursor, limit, {
    operation: "list",
    typeFilter,
  });
  const entries = await ctx.api.fullEntries(page.entries.map((entry) => entry.id));
  const ordered = [...entries].toSorted((left, right) => left.id - right.id);
  const context = await ctx.api.displayContext(ordered);
  const from = page.entries.length > 0 ? page.startIndex + 1 : 0;
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));
  view(s.alert(listCopy.heading(page.page, totalPages, from, page.endIndex, page.total)));
  view(
    renderTable(
      [...listCopy.columns],
      [
        [
          String(page.page),
          String(limit),
          typeFilter ?? "-",
          showExtra ? listCopy.yes : listCopy.no,
        ],
      ],
    ),
  );
  view("");
  displayWords(view, ordered, {
    startIndex: page.startIndex,
    spacing: true,
    showDates: false,
    showSenseCue: true,
    showExtra: showExtra ?? false,
    resolveEntryById: context.resolve,
  });
  view(listCopy.showing(from, page.endIndex, page.total, page.page, totalPages));
}

export async function handleSearch(ctx: AppContext, input: string): Promise<void> {
  const { view } = ctx.io;
  const parsed = parseSearchInput(input);
  for (const warning of parsed.warnings) view(s.w(warning));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) view(s.e(error));
    return;
  }
  const { query, options } = parsed.value;
  if (!query.trim()) {
    view(searchCopy.enterTerm);
    return;
  }
  const recorded = ctx.api.recordSearch(query);
  try {
    await showSearchResults(ctx, query, options);
  } finally {
    await recorded;
  }
}

async function showSearchResults(
  ctx: AppContext,
  query: string,
  options: ParsedSearch["options"],
): Promise<void> {
  const { view } = ctx.io;
  const page = await ctx.api.page(
    "search",
    { query, typeFilter: options.typeFilter, includeAllFields: options.includeAllFields },
    options.cursor,
    options.limit,
    { operation: "search", typeFilter: options.typeFilter },
  );
  if (page.entries.length === 0) {
    view(searchCopy.noMatches(query));
    return;
  }
  const results = await ctx.api.fullEntries(page.entries.map((entry) => entry.id));
  const context = await ctx.api.displayContext(results);
  const from = page.startIndex + 1;
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));
  view(s.alert(searchCopy.heading(query, page.page, totalPages, page.total)));
  view(
    renderTable(
      [...searchCopy.columns],
      [
        [
          query,
          String(page.page),
          String(from),
          String(page.endIndex),
          String(page.total),
          options.includeAllFields ? searchCopy.allFields : searchCopy.termField,
        ],
      ],
    ),
  );
  view("");
  displayWords(view, results, {
    highlightTerm: query,
    highlightAll: options.highlightAll,
    showSenseCue: true,
    showExtra: options.showExtra ?? false,
    resolveEntryById: context.resolve,
  });
  view(searchCopy.showing(from, page.endIndex, page.total, page.page, totalPages));
}

export async function handleShow(ctx: AppContext, input: string): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return ctx.io.view(showCopy.missingId);
  if (!/^\d+$/.test(trimmed)) return ctx.io.view(showCopy.numericId);
  const id = Number.parseInt(trimmed, 10);
  const detail = await ctx.api.getEntry(id);
  if (!detail) throw new CliError(showCopy.noEntry(id), "api");
  await showEntry(ctx, detail.entry, null, {
    showPosition: false,
    showDates: false,
    showSenseCue: true,
    showExtra: true,
    siblings: true,
  });
}

export async function handleDelete(ctx: AppContext, input: string): Promise<void> {
  const { io } = ctx;
  const { entry, displayTerm } = await resolveTarget(ctx, input, "delete");
  const confirmation = await io.ask(s.alert(deleteCopy.confirm(entry.id, displayTerm)));
  if (!confirmation.toLowerCase().startsWith("y")) {
    io.clearScreen();
    io.view(deleteCopy.cancelled);
    return;
  }
  const deleted = await ctx.api.deleteEntry(entry.id, entry.revision, { term: displayTerm });
  io.clearScreen();
  io.view(deleteCopy.success);
  await showEntry(ctx, deleted.entry, null, {
    showPosition: false,
    showDates: false,
    siblings: true,
  });
}

const allFields: Include = {
  term: true,
  senseCue: true,
  partOfSpeech: true,
  tags: true,
  constructionType: true,
  forms: true,
  irregular: true,
  related: true,
  examples: true,
  collocations: true,
};

const includeByMode: Record<"fast" | "normal" | "detail" | "json" | "search", Include> = {
  fast: { collocations: true },
  normal: { term: true, senseCue: true, examples: true, related: true },
  detail: allFields,
  json: allFields,
  search: allFields,
};

export type EditMode = keyof typeof includeByMode;

export const editModeFor = (mode: AppMode): EditMode => (mode === "ai" ? "detail" : mode);

async function promptJsonDefaults(ctx: AppContext): Promise<PromptDefaults> {
  while (true) {
    let input: string;
    try {
      input = await ctx.io.askJson(editCopy.jsonPrompt, "editor");
    } catch (error) {
      if (isPromptAbort(error)) throw new PromptAbortedError();
      throw error;
    }
    if (!input.trim()) return {};
    if (input.trim() === "q") throw new PromptAbortedError();
    const { result, error } = parseJsonDefaults(input);
    if (!result) {
      ctx.io.view(error || editCopy.jsonParseFailed);
      continue;
    }
    if (result.defaultsList) {
      ctx.io.view(editCopy.singleObject);
      continue;
    }
    for (const warning of result.warnings) ctx.io.view(editCopy.warning(warning));
    return result.defaults ?? {};
  }
}

/** Edit request body; an explicitly cleared part of speech is sent as `""` so JSON keeps the clear. */
function toUpdatePayload(prompted: PromptResult, extra?: string): EntryChanges {
  const { irregular, related, ...fields } = prompted;
  const hasIrregular = Object.prototype.hasOwnProperty.call(prompted, "irregular");
  const clearedPos =
    Object.prototype.hasOwnProperty.call(prompted, "partOfSpeech") &&
    prompted.partOfSpeech === undefined;
  return {
    ...fields,
    ...(clearedPos && { partOfSpeech: "" }),
    ...(extra !== undefined && { extra }),
    ...(related !== undefined && { relatedTokens: related }),
    ...(hasIrregular && { grammar: { irregular } }),
  };
}

/** Returns true when the entry was updated or already matched the input (legacy NO_CHANGES). */
export async function handleEdit(ctx: AppContext, input: string, mode: EditMode): Promise<boolean> {
  const { io } = ctx;
  const resolved = await resolveTarget(ctx, input, "edit");
  const { entry, displayTerm } = resolved;
  if (resolved.matchedBy === "id") io.view(editCopy.foundId(entry.id, displayTerm));
  io.view(editCopy.editing(entry.id, displayTerm));
  let jsonDefaults: PromptDefaults | undefined;
  let prompted: PromptResult;
  try {
    const prepared = ctx.api.prepare(displayTerm);
    prepared.catch(() => {});
    if (mode === "json") jsonDefaults = await promptJsonDefaults(ctx);
    prompted = await promptTermFields(io, displayTerm, {
      include: includeByMode[mode],
      existingEntry: entry,
      defaults: jsonDefaults,
      mode: "edit",
      inference: inferenceFor(ctx, displayTerm, (await prepared).inferred),
    });
  } catch (error) {
    if (!isPromptAbort(error)) throw error;
    io.clearScreen();
    io.view(editCopy.cancelled);
    return false;
  }
  io.clearScreen();
  const changes = toUpdatePayload(prompted, mode === "json" ? jsonDefaults?.extra : undefined);
  try {
    const updated = await ctx.api.updateEntry(entry.id, entry.revision, changes, {
      term: displayTerm,
      senseCue: prompted.senseCue,
    });
    io.view(editCopy.success);
    await showEntry(ctx, updated.entry, updated.entry.id, { showDates: false, siblings: true });
    return true;
  } catch (error) {
    if (
      error instanceof CliError &&
      error.apiError &&
      legacyCodeOf(error.apiError) === "NO_CHANGES"
    ) {
      io.view(error.message);
      return true;
    }
    throw error;
  }
}
