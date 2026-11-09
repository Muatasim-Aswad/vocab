import type { Entry, EntryInput } from "../../infra/api.ts";
import type { AppContext } from "../../platform/context.ts";
import { isPromptAbort, s } from "../../platform/terminal.ts";
import { addCopy } from "./add-copy.ts";
import { handleEdit, type EditMode } from "./commands.ts";
import { inferenceFor, showEntries, showEntry } from "./context.ts";
import { promptTermFields, type Include, type PromptResult } from "./prompter.ts";

export type AddModeConfig = {
  missingInputMessage: string;
  editMode: EditMode;
  include?: Include;
  announceMessage?: (term: string) => string;
};

export const addModes: Record<"normal" | "detail", AddModeConfig> = {
  normal: {
    missingInputMessage: addCopy.normalMissing,
    editMode: "normal",
    include: { examples: true, forms: true, related: true },
    announceMessage: addCopy.normalAnnouncement,
  },
  detail: {
    missingInputMessage: addCopy.detailMissing,
    editMode: "detail",
    include: {
      examples: true,
      partOfSpeech: true,
      tags: true,
      forms: true,
      irregular: true,
      related: true,
      collocations: true,
    },
    announceMessage: addCopy.detailAnnouncement,
  },
};

/** Create request; the API parses article/`zich` prefixes from the display term. */
function toCreatePayload(term: string, prompted: PromptResult, extra?: string): EntryInput {
  const { lemma, irregular, related, ...fields } = prompted;
  return {
    language: "nl",
    lemma: lemma ?? term,
    ...(extra !== undefined && { extra }),
    ...(related !== undefined && { relatedTokens: related }),
    ...fields,
    ...(irregular !== undefined && { grammar: { irregular } }),
  };
}

const byId = (entries: Entry[]) => [...entries].toSorted((a, b) => a.id - b.id);
const isCancel = (value: string) => ["q", "quit"].includes(value.trim().toLowerCase());

/** Normal and detail Add: duplicate-meaning decisions, label backfills, prompts, create. */
export async function handleAddMode(
  ctx: AppContext,
  input: string,
  config: AddModeConfig,
): Promise<boolean> {
  const { io, api } = ctx;
  const rawTerm = input.trim();
  if (!rawTerm) {
    io.view(config.missingInputMessage);
    return false;
  }
  const plain = (message: string) => io.view(s.white(message));
  const cancelled = () => {
    io.clearScreen();
    io.view(addCopy.cancelled);
    return false;
  };
  try {
    const prepared = await api.prepare(rawTerm);
    const term = prepared.term;
    const lemma = prepared.inferred.lemma ?? term;
    let sameLemma = byId(await api.fullEntries(prepared.matches.map((match) => match.id)));
    const requiresSenseCue = sameLemma.length > 0;
    const backfills: Array<{ id: number; expectedRevision: number; senseCue: string }> = [];

    if (requiresSenseCue) {
      io.clearScreen();
      while (true) {
        plain(addCopy.existingCount(lemma, sameLemma.length));
        plain(addCopy.chooseExisting);
        plain("");
        await showEntries(ctx, sameLemma, { showDates: false, showExtra: true });
        plain("");
        const decision = await io.choose(addCopy.chooseAction, [
          {
            value: "a",
            ...addCopy.addMeaning,
          },
          {
            value: "e",
            ...addCopy.editEntry,
          },
          { value: "q", ...addCopy.cancel },
        ]);
        if (decision === "q") {
          io.clearScreen();
          plain(addCopy.cancelled);
          return false;
        }
        if (decision === "e") {
          const selected = await io.choose(addCopy.selectEntry, [
            ...sameLemma.map((entry) => ({
              value: String(entry.id),
              label: addCopy.entryOption(entry.id, entry.lemma, entry.senseCue),
              description: addCopy.openEntry,
            })),
            { value: "back", ...addCopy.back },
            { value: "cancel", ...addCopy.cancel },
          ]);
          if (selected === "cancel") {
            io.clearScreen();
            plain(addCopy.cancelled);
            return false;
          }
          io.clearScreen();
          if (selected === "back") continue;
          return handleEdit(ctx, selected, config.editMode);
        }
        io.clearScreen();
        break;
      }
      io.clearScreen();
      const refreshed = await api.prepare(term);
      sameLemma = byId(await api.fullEntries(refreshed.matches.map((match) => match.id)));
      for (const entry of sameLemma.filter((candidate) => !candidate.senseCue?.trim())) {
        while (true) {
          io.clearScreen();
          plain(addCopy.existingNeedsLabel);
          plain("");
          await showEntry(ctx, entry, entry.id, { showDates: false, showExtra: true });
          plain("");
          const cue = await io.ask(s.white(addCopy.labelPrompt));
          if (isCancel(cue)) {
            io.clearScreen();
            plain(addCopy.cancelled);
            return false;
          }
          if (!cue.trim()) {
            plain(addCopy.labelRequired);
            continue;
          }
          backfills.push({ id: entry.id, expectedRevision: entry.revision, senseCue: cue.trim() });
          break;
        }
      }
      io.clearScreen();
      plain(addCopy.addingMeaning(lemma));
      plain(addCopy.meaningInstructions);
      plain(addCopy.partOfSpeechHint);
    }

    if (config.announceMessage) io.view(config.announceMessage(rawTerm));
    const prompted: PromptResult = await promptTermFields(io, term, {
      include: { ...config.include, ...(requiresSenseCue && { senseCue: true }) },
      mode: "create",
      inference: inferenceFor(ctx, term, prepared.inferred),
    });
    const created = await api.createEntry(toCreatePayload(term, prompted), backfills, {
      term,
      senseCue: prompted.senseCue,
    });
    io.clearScreen();
    await showEntry(ctx, created.entry, created.entry.id, { showDates: false, siblings: true });
    return true;
  } catch (error) {
    if (isPromptAbort(error)) return cancelled();
    throw error;
  }
}
