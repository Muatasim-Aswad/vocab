import type { Entry } from "../../infra/api.ts";
import type { AppContext } from "../../platform/context.ts";
import { formatDisplayTerm } from "../../shared/display-term.ts";
import { CliError, type ErrorContext } from "../../shared/errors.ts";
import { targetCopy } from "./context-copy.ts";
import type { Inference } from "./prompter.ts";
import { displayWord, type DisplayWordOptions } from "./render.ts";

/** Renders one entry after loading its relation targets (and optionally sibling meanings) in parallel. */
export async function showEntry(
  ctx: AppContext,
  entry: Entry,
  position: number | null,
  options: Omit<DisplayWordOptions, "resolveEntryById" | "siblings"> & { siblings?: boolean },
): Promise<void> {
  const { siblings, ...display } = options;
  const view = await ctx.api.displayContext([entry], { siblings });
  displayWord(ctx.io.view, entry, position, {
    ...display,
    resolveEntryById: view.resolve,
    ...(siblings && { siblings: view.siblingsOf(entry) }),
  });
}

/** Renders several entries from one parallel context load. */
export async function showEntries(
  ctx: AppContext,
  entries: Entry[],
  options: Omit<DisplayWordOptions, "resolveEntryById" | "siblings"> & { siblings?: boolean },
): Promise<void> {
  const { siblings, ...display } = options;
  const view = await ctx.api.displayContext(entries, { siblings });
  for (const entry of entries)
    displayWord(ctx.io.view, entry, entry.id, {
      ...display,
      resolveEntryById: view.resolve,
      ...(siblings && { siblings: view.siblingsOf(entry) }),
    });
}

/** Server inference for a term: prepared defaults plus on-demand forms for a chosen part of speech. */
export function inferenceFor(
  ctx: AppContext,
  term: string,
  inferred: Inference["inferred"],
): Inference {
  return {
    inferred,
    forms: (request) =>
      ctx.api.resolveForms({
        term,
        partOfSpeech: request.partOfSpeech,
        irregular: request.irregular,
        ...(request.separable !== undefined && { separable: request.separable }),
      }),
  };
}

export type ResolvedTarget = {
  entry: Entry;
  matchedBy: "last" | "term" | "id";
  displayTerm: string;
};

/** Legacy `delete`/`edit` target: numeric id, term (must be unique), or the newest active entry. */
export async function resolveTarget(
  ctx: AppContext,
  input: string,
  operation: "delete" | "edit",
): Promise<ResolvedTarget> {
  const trimmed = input.trim();
  const context: ErrorContext = { operation };
  if (!trimmed) {
    const last = await ctx.api.page("list", {}, undefined, 1, context);
    const id = last.entries[0]?.id;
    const detail = id === undefined ? null : await ctx.api.getEntry(id);
    if (!detail) throw new CliError(targetCopy.noTerms(operation), "api");
    return { entry: detail.entry, matchedBy: "last", displayTerm: formatDisplayTerm(detail.entry) };
  }
  if (/^\d+$/.test(trimmed)) {
    const id = Number.parseInt(trimmed, 10);
    const detail = await ctx.api.getEntry(id);
    if (!detail) throw new CliError(targetCopy.noId(id), "api");
    return { entry: detail.entry, matchedBy: "id", displayTerm: formatDisplayTerm(detail.entry) };
  }
  const term = trimmed.toLowerCase().replace(/\s+/g, " ");
  const matches = await ctx.api.lookup(term);
  if (matches.length === 0) throw new CliError(targetCopy.noTerm(term), "api");
  if (matches.length > 1) throw new CliError(targetCopy.ambiguous(term), "api");
  return { entry: matches[0]!.entry, matchedBy: "term", displayTerm: term };
}
