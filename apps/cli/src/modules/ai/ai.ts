import type { Entry, GeneratedDrafts } from "../../infra/api.ts";
import type { AppContext } from "../../platform/context.ts";
import { isPromptAbort } from "../../platform/terminal.ts";
import { CliError } from "../../shared/errors.ts";
import { handleEdit } from "../vocabulary/commands.ts";
import { showEntry } from "../vocabulary/context.ts";
import { parseJsonDefaults } from "../vocabulary/json-input.ts";
import { StructuredAddFlow } from "../vocabulary/structured.ts";
import { aiCopy, jsonAddCopy } from "./copy.ts";

type Draft = GeneratedDrafts["drafts"][number];

/** Server draft fields in the legacy AI JSON shape, validated by the same parser as pasted JSON. */
function toLegacyDraft(draft: Draft): Record<string, unknown> {
  const grammar = draft.grammar as
    | { irregular?: unknown; isSeparable?: unknown; isCountable?: unknown }
    | undefined;
  const relations = [
    ...(draft.relations ?? []),
    ...(draft.relatedTokens ?? []).map((token) => ({ type: "related", term: token })),
  ];
  return {
    term: draft.term,
    senseCue: draft.senseCue,
    extra: draft.extra,
    examples: draft.examples,
    collocations: draft.collocations,
    tags: draft.tags,
    constructionType: draft.constructionType,
    forms: draft.forms,
    irregular:
      draft.irregular ?? (typeof grammar?.irregular === "boolean" ? grammar.irregular : undefined),
    separable:
      draft.separable ??
      (typeof grammar?.isSeparable === "boolean" ? grammar.isSeparable : undefined),
    uncountable:
      draft.uncountable ??
      (typeof grammar?.isCountable === "boolean" ? !grammar.isCountable : undefined),
    partOfSpeech: draft.partOfSpeech,
    relations: relations.length > 0 ? relations : undefined,
  };
}

async function renderExisting(ctx: AppContext, entries: Entry[]): Promise<void> {
  ctx.io.view(aiCopy.existingHeading);
  ctx.io.view("");
  for (const entry of entries)
    await showEntry(ctx, entry, entry.id, { showDates: false, showExtra: true, siblings: true });
  ctx.io.view("");
}

/** AI Add: the API calls Gemini; the CLI decides about existing entries and edits the drafts. */
export async function handleAiInput(ctx: AppContext, input: string): Promise<boolean> {
  const { io, api } = ctx;
  const term = input.trim();
  if (!term) {
    io.view(aiCopy.enterTerm);
    return false;
  }
  const cancelled = () => {
    io.clearScreen();
    io.view(aiCopy.cancelled);
    return false;
  };
  const prepared = await api.prepare(term);
  const existing = (await api.fullEntries(prepared.matches.map((match) => match.id))).toSorted(
    (a, b) => a.id - b.id,
  );
  if (existing.length > 0) {
    try {
      const lemma = prepared.inferred.lemma ?? prepared.term;
      io.clearScreen();
      io.view(aiCopy.existingCount(lemma, existing.length));
      await renderExisting(ctx, existing);
      const decision = await io.choose(aiCopy.chooseBeforeCall, [
        {
          value: "use-existing",
          ...aiCopy.useExisting,
        },
        {
          value: "edit-existing",
          ...aiCopy.editExisting,
        },
        {
          value: "add-ai",
          ...aiCopy.addWithAi,
        },
        { value: "cancel", ...aiCopy.cancel },
      ]);
      if (decision === "cancel") return cancelled();
      if (decision === "use-existing") {
        io.clearScreen();
        io.view(aiCopy.usingExisting);
        io.view("");
        await renderExisting(ctx, existing);
        return true;
      }
      if (decision === "edit-existing") {
        let selected = existing[0]!.id;
        if (existing.length > 1) {
          const choice = await io.choose(aiCopy.selectExisting, [
            ...existing.map((entry) => ({
              value: String(entry.id),
              label: aiCopy.entryOption(entry.id, entry.lemma, entry.senseCue),
              description: aiCopy.openEntry,
            })),
            { value: "cancel", ...aiCopy.cancel },
          ]);
          if (choice === "cancel") return cancelled();
          selected = Number.parseInt(choice, 10);
        }
        return handleEdit(ctx, String(selected), "detail");
      }
    } catch (error) {
      if (isPromptAbort(error)) return cancelled();
      throw error;
    }
  }

  const startSpinner = () => io.startSpinner(aiCopy.generating);
  let stopSpinner = startSpinner();
  const startedAt = ctx.now();
  const status = setInterval(() => {
    stopSpinner();
    io.view(aiCopy.working(Math.max(1, Math.round((ctx.now() - startedAt) / 1000))));
    stopSpinner = startSpinner();
  }, 5000);
  let generated: GeneratedDrafts;
  try {
    generated = await api.generateDraft(term, existing.length > 0);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    if (error.kind === "auth") throw error;
    io.view(aiCopy.failed(error.message));
    return false;
  } finally {
    clearInterval(status);
    stopSpinner();
  }
  for (const warning of generated.warnings) io.view(aiCopy.warning(warning));
  if (generated.drafts.length === 0) {
    io.view(aiCopy.missingTerm);
    return false;
  }
  const { result, error } = parseJsonDefaults(JSON.stringify(generated.drafts.map(toLegacyDraft)));
  if (error || !result) {
    io.view(error || aiCopy.parseFailed);
    return false;
  }
  const defaultsList = result.defaultsList ?? (result.defaults ? [result.defaults] : []);
  if (defaultsList.length === 0 || defaultsList.some((defaults) => !defaults.term?.trim())) {
    io.view(aiCopy.missingTerm);
    return false;
  }
  return new StructuredAddFlow(ctx, { formsConflictMode: ctx.preferences().formsConflict }).run(
    defaultsList,
  );
}

export async function handleJsonInput(ctx: AppContext, input: string): Promise<boolean> {
  const { view } = ctx.io;
  if (!input) {
    view(jsonAddCopy.paste);
    return false;
  }
  const { result, error } = parseJsonDefaults(input);
  if (error || !result) {
    view(error || jsonAddCopy.parseFailed);
    return false;
  }
  for (const warning of result.warnings) view(jsonAddCopy.warning(warning));
  const defaultsList = result.defaultsList ?? (result.defaults ? [result.defaults] : []);
  if (
    defaultsList.length === 0 ||
    defaultsList.some((defaults) => typeof defaults.term !== "string" || !defaults.term.trim())
  ) {
    view(jsonAddCopy.missingTerm);
    return false;
  }
  return new StructuredAddFlow(ctx, { formsConflictMode: ctx.preferences().formsConflict }).run(
    defaultsList,
  );
}
