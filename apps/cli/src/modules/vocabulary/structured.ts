import type { Entry } from "../../infra/api.ts";
import type { FormsConflictMode } from "../../infra/config.ts";
import type { AppContext } from "../../platform/context.ts";
import { isPromptAbort, PromptAbortedError } from "../../platform/terminal.ts";
import { formatDisplayTerm } from "../../shared/display-term.ts";
import { CliError, legacyCodeOf } from "../../shared/errors.ts";
import { handleEdit } from "./commands.ts";
import { showEntry } from "./context.ts";
import type { PromptDefaults } from "./json-input.ts";
import { processArrayInput } from "./prompter.ts";
import { structuredCopy } from "./structured-copy.ts";
import {
  cueSet,
  cueSuggestions,
  findExistingLabelConflict,
  findIncomingLabelConflict,
  groupDrafts,
  hasCue,
  isValidCue,
  normalizeCue,
  otherDraftCues,
  toCreatePayload,
  toUpdatePayload,
  type Draft,
  type DraftAction,
} from "./structured-drafts.ts";

type GroupResult = { handled: boolean; abortBatch: boolean; entries: Entry[] };

const isCancel = (value: string) => ["q", "quit"].includes(value.trim().toLowerCase());
const isClear = (value: string) => ["-", "clear"].includes(value.trim().toLowerCase());

function formsLabel(partOfSpeech: string | undefined): string {
  switch (partOfSpeech) {
    case "VERB":
      return structuredCopy.verbForms;
    case "NOUN":
      return structuredCopy.nounForms;
    case "ADJ":
      return structuredCopy.adjectiveForms;
    default:
      return structuredCopy.forms;
  }
}

const formatFormList = (values: string[] | undefined) =>
  values && values.length > 0 ? values.join(", ") : structuredCopy.none;

const explicitToken = /^[+\-~^]?id:\d+$/i;
const tokenPrefix = (token: string) =>
  ["+", "-", "~", "^"].includes(token.trim()[0] ?? "") ? token.trim()[0]! : "";

export type StructuredOptions = { formsConflictMode: FormsConflictMode };

/** JSON and AI drafts: group by lemma, settle meaning labels and conflicts, then create or update. */
export class StructuredAddFlow {
  constructor(
    private readonly ctx: AppContext,
    private readonly options: StructuredOptions,
  ) {}

  private get io() {
    return this.ctx.io;
  }

  private render(entry: Entry): Promise<void> {
    return showEntry(this.ctx, entry, entry.id, {
      showDates: false,
      showExtra: true,
      showSenseCue: true,
      siblings: true,
    });
  }

  private async promptText(label: string, current?: string): Promise<string | undefined> {
    const answer = await this.io.ask(structuredCopy.prompt(label, current));
    if (isCancel(answer)) throw new PromptAbortedError();
    if (isClear(answer)) return "";
    return answer.trim() || undefined;
  }

  private async promptCustomCue(label: string): Promise<string> {
    while (true) {
      const value = (await this.promptText(label))?.trim() ?? "";
      if (!value) this.io.view(structuredCopy.labelRequired);
      else if (!isValidCue(value)) this.io.view(structuredCopy.labelLength);
      else return value;
    }
  }

  private async promptRequiredCue(
    label: string,
    drafts: Draft[],
    exclude?: ReadonlySet<string>,
  ): Promise<string> {
    const suggestions = cueSuggestions(drafts, exclude);
    if (suggestions.length === 0) return this.promptCustomCue(label);
    const choice = await this.io.choose(label, [
      ...suggestions.map((suggestion) => ({
        value: `suggest:${suggestion.normalized}`,
        label: suggestion.label,
        description: structuredCopy.suggestedLabel,
      })),
      {
        value: "custom",
        ...structuredCopy.customLabel,
      },
      { value: "cancel", ...structuredCopy.cancel },
    ]);
    if (choice === "cancel") throw new PromptAbortedError();
    const selected = suggestions.find(
      (suggestion) => `suggest:${suggestion.normalized}` === choice,
    );
    return selected?.label ?? this.promptCustomCue(label);
  }

  /** Provided versus server-inferred forms, resolved by preference or choice. */
  private async reconcileForms(draft: Draft): Promise<void> {
    const resolution = await this.ctx.api.resolveForms({
      term: draft.term,
      ...(draft.partOfSpeech && { partOfSpeech: draft.partOfSpeech }),
      ...(draft.forms && { providedForms: draft.forms }),
      ...(draft.irregular !== undefined && { irregular: draft.irregular }),
      ...(draft.separable !== undefined && { separable: draft.separable }),
    });
    const provided = resolution.providedForms;
    const inferred = resolution.inferredForms;
    if (!inferred || !provided) {
      draft.forms = provided ?? inferred;
      return;
    }
    const sameForms =
      JSON.stringify([...provided].toSorted()) === JSON.stringify([...inferred].toSorted());
    if (sameForms) {
      draft.forms = provided;
      return;
    }
    this.io.view(structuredCopy.formsMismatch(draft.term));
    this.io.view(structuredCopy.provided(formatFormList(provided)));
    this.io.view(structuredCopy.inferred(formatFormList(inferred)));
    const mode = this.options.formsConflictMode;
    const configured = mode === "ask" ? null : mode;
    if (configured) this.io.view(structuredCopy.configuredForms(configured));
    const choice =
      configured ??
      (await this.io.choose(structuredCopy.chooseForms, [
        {
          value: "provided",
          ...structuredCopy.keepProvided,
        },
        {
          value: "inferred",
          ...structuredCopy.useInferred,
        },
        {
          value: "manual",
          ...structuredCopy.manualForms,
        },
      ]));
    if (choice === "inferred") draft.forms = inferred;
    else if (choice === "provided") draft.forms = provided;
    else draft.forms = await this.promptManualForms(draft, provided);
  }

  private async promptManualForms(draft: Draft, provided: string[]): Promise<string[] | undefined> {
    const label = formsLabel(draft.partOfSpeech);
    const answer = await this.io.ask(structuredCopy.formsPrompt(label, formatFormList(provided)));
    if (isCancel(answer)) throw new PromptAbortedError();
    if (isClear(answer)) return undefined;
    const manual = answer.trim() ? processArrayInput(answer, provided) : provided;
    if (manual.length === 0) return undefined;
    const resolved = await this.ctx.api.resolveForms({ term: draft.term, providedForms: manual });
    return resolved.providedForms;
  }

  /** The API hides ambiguous candidates, so the CLI finds them through public term lookups. */
  private async chooseAmbiguousRelation(draft: Draft): Promise<boolean> {
    const tokens = (draft.related ?? []).filter((token) => !explicitToken.test(token.trim()));
    const lookups = await Promise.all(
      tokens.map(async (token) => {
        const term = token
          .trim()
          .replace(/^[+\-~^]/, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        const active = term ? (await this.ctx.api.lookup(term)).map((detail) => detail.entry) : [];
        const candidates = active.filter((entry) => entry.status !== "stub");
        const exact = candidates.filter(
          (entry) => formatDisplayTerm(entry) === term || entry.lemma === term,
        );
        return {
          token,
          term,
          entries: (exact.length > 1 ? exact : candidates).toSorted((a, b) => a.id - b.id),
        };
      }),
    );
    const ambiguous = lookups.find((lookup) => lookup.entries.length > 1);
    if (!ambiguous) return false;
    this.io.view(structuredCopy.ambiguousRelation(ambiguous.term));
    for (const entry of ambiguous.entries) await this.render(entry);
    const selected = await this.io.choose(structuredCopy.selectRelation, [
      ...ambiguous.entries.map((entry) => ({
        value: String(entry.id),
        label: structuredCopy.relationEntry(entry.id, formatDisplayTerm(entry), entry.senseCue),
        description: structuredCopy.relationDescription,
      })),
      { value: "cancel", ...structuredCopy.cancel },
    ]);
    if (selected === "cancel") throw new PromptAbortedError();
    const target = Number.parseInt(selected, 10);
    if (!Number.isFinite(target) || target <= 0) return false;
    const normalized = ambiguous.token.trim().toLowerCase();
    draft.related = draft.related?.map((token) =>
      token.trim().toLowerCase() === normalized
        ? `${tokenPrefix(ambiguous.token)}id:${target}`
        : token,
    );
    return true;
  }

  private async persist(
    draft: Draft,
    action: Exclude<DraftAction, { kind: "skip" }>,
  ): Promise<Entry> {
    while (true) {
      try {
        if (action.kind === "update") {
          const current = await this.ctx.api.getEntry(action.targetId);
          if (!current) throw new CliError(structuredCopy.noEntry(action.targetId), "api");
          const updated = await this.ctx.api.updateEntry(
            action.targetId,
            current.entry.revision,
            toUpdatePayload(draft, current.entry),
            { term: draft.term, senseCue: draft.senseCue },
          );
          return updated.entry;
        }
        const created = await this.ctx.api.createEntry(toCreatePayload(draft), [], {
          term: draft.term,
          senseCue: draft.senseCue,
        });
        return created.entry;
      } catch (error) {
        const ambiguous =
          error instanceof CliError &&
          error.apiError !== undefined &&
          legacyCodeOf(error.apiError) === "RELATION_TARGET_AMBIGUOUS";
        if (!ambiguous || !(await this.chooseAmbiguousRelation(draft))) throw error;
      }
    }
  }

  private async singleUnsensedConflict(
    existing: Entry[],
    drafts: Draft[],
  ): Promise<GroupResult | null> {
    const [entry] = existing;
    const [draft] = drafts;
    if (
      !entry ||
      !draft ||
      existing.length !== 1 ||
      drafts.length !== 1 ||
      hasCue(entry.senseCue) ||
      hasCue(draft.senseCue)
    )
      return null;
    const choice = await this.io.choose(structuredCopy.unsensedConflict(draft.term), [
      {
        value: "update",
        ...structuredCopy.updateIncoming,
      },
      {
        value: "split",
        ...structuredCopy.splitSenses,
      },
      {
        value: "edit",
        ...structuredCopy.editExisting,
      },
      {
        value: "skip",
        ...structuredCopy.skipIncoming,
      },
      { value: "cancel", ...structuredCopy.cancel },
    ]);
    if (choice === "cancel") {
      this.io.clearScreen();
      this.io.view(structuredCopy.cancelled);
      return { handled: false, abortBatch: true, entries: [] };
    }
    if (choice === "skip") return { handled: false, abortBatch: false, entries: [] };
    if (choice === "edit")
      return {
        handled: await handleEdit(this.ctx, String(entry.id), "detail"),
        abortBatch: false,
        entries: [],
      };
    if (choice === "update") {
      await this.reconcileForms(draft);
      return {
        handled: true,
        abortBatch: false,
        entries: [await this.persist(draft, { kind: "update", targetId: entry.id })],
      };
    }
    return null;
  }

  private async chooseDraftActions(
    drafts: Draft[],
    existing: Entry[],
  ): Promise<DraftAction[] | GroupResult> {
    const actions: DraftAction[] = [];
    for (const draft of drafts) {
      const result = await this.chooseDraftAction(draft, drafts, existing);
      if (!("kind" in result)) return result;
      actions.push(result);
    }
    return actions;
  }

  private async chooseDraftAction(
    draft: Draft,
    drafts: Draft[],
    existing: Entry[],
  ): Promise<DraftAction | GroupResult> {
    if (!hasCue(draft.senseCue)) return { kind: "create" };
    while (true) {
      const match = existing.find(
        (entry) => normalizeCue(entry.senseCue ?? "") === normalizeCue(draft.senseCue ?? ""),
      );
      if (!match) return { kind: "create" };
      const choice = await this.io.choose(
        structuredCopy.matchingDraft(
          draft.index + 1,
          draft.term,
          hasCue(draft.senseCue) ? draft.senseCue : undefined,
        ),
        [
          {
            value: "update",
            label: structuredCopy.updateExisting(match.id),
            description: structuredCopy.updateDescription,
          },
          {
            value: "separate",
            ...structuredCopy.separate,
          },
          {
            value: "edit",
            ...structuredCopy.editMatch,
          },
          {
            value: "skip",
            ...structuredCopy.skipMatch,
          },
          { value: "cancel", ...structuredCopy.cancel },
        ],
      );
      if (choice === "cancel") {
        this.io.clearScreen();
        this.io.view(structuredCopy.cancelled);
        return { handled: false, abortBatch: true, entries: [] };
      }
      if (choice === "skip") return { kind: "skip" };
      if (choice === "edit")
        return {
          handled: await handleEdit(this.ctx, String(match.id), "detail"),
          abortBatch: false,
          entries: [],
        };
      if (choice === "update") return { kind: "update", targetId: match.id };
      await this.promptSeparateLabel(draft, drafts);
    }
  }

  private async promptSeparateLabel(draft: Draft, drafts: Draft[]): Promise<void> {
    while (true) {
      draft.senseCue = await this.promptRequiredCue(
        structuredCopy.newDraftLabel(draft.index + 1),
        drafts,
        cueSet([draft.senseCue, ...otherDraftCues(drafts, draft)]),
      );
      const duplicate = drafts.some(
        (other) =>
          other !== draft &&
          hasCue(other.senseCue) &&
          normalizeCue(other.senseCue ?? "") === normalizeCue(draft.senseCue ?? ""),
      );
      if (!duplicate) return;
      this.io.view(structuredCopy.duplicateIncoming(draft.index + 1));
    }
  }

  private async resolveGroup(drafts: Draft[], matches: number[]): Promise<GroupResult> {
    const first = drafts[0]!;
    const existing = (await this.ctx.api.fullEntries(matches))
      .map((entry) => ({ ...entry }))
      .toSorted((a, b) => a.id - b.id);
    const missingExistingIds = new Set(
      existing.filter((entry) => !hasCue(entry.senseCue)).map((entry) => entry.id),
    );
    if (existing.length > 0) {
      this.io.view(structuredCopy.existingFor(first.lemmaKey));
      for (const entry of existing) await this.render(entry);
    }
    const unsensed = await this.singleUnsensedConflict(existing, drafts);
    if (unsensed) return unsensed;

    await this.promptMissingLabels(drafts, existing);
    await this.resolveExistingLabels(drafts, existing, missingExistingIds);
    await this.resolveIncomingLabels(drafts);

    const actions = await this.chooseDraftActions(drafts, existing);
    if (!Array.isArray(actions)) return actions;

    return this.persistGroup(drafts, existing, missingExistingIds, actions);
  }

  private async promptMissingLabels(drafts: Draft[], existing: Entry[]): Promise<void> {
    if (existing.length + drafts.length <= 1) return;
    const missingExisting = existing.filter((entry) => !hasCue(entry.senseCue));
    const missingDrafts = drafts.filter((draft) => !hasCue(draft.senseCue));
    if (missingExisting.length === 0 && missingDrafts.length === 0) return;

    this.io.view(structuredCopy.resolveLabels(drafts[0]!.lemmaKey));
    for (const entry of missingExisting)
      entry.senseCue = await this.promptRequiredCue(structuredCopy.existingLabel(entry.id), drafts);
    for (const draft of missingDrafts)
      draft.senseCue = await this.promptRequiredCue(
        structuredCopy.draftLabel(draft.index + 1),
        drafts,
      );
  }

  private async resolveExistingLabels(
    drafts: Draft[],
    existing: Entry[],
    missingExistingIds: ReadonlySet<number>,
  ): Promise<void> {
    while (true) {
      const target = findExistingLabelConflict(existing, missingExistingIds);
      if (!target) return;
      this.io.view(structuredCopy.duplicateExisting(target.id));
      target.senseCue = await this.promptRequiredCue(
        structuredCopy.existingLabel(target.id),
        drafts,
        cueSet([target.senseCue]),
      );
    }
  }

  private async resolveIncomingLabels(drafts: Draft[]): Promise<void> {
    while (true) {
      const conflict = findIncomingLabelConflict(drafts);
      if (!conflict) return;
      this.io.view(structuredCopy.sharedLabel(conflict[0].index + 1, conflict[1].index + 1));
      for (const draft of drafts) {
        if (!hasCue(draft.senseCue)) continue;
        const key = normalizeCue(draft.senseCue ?? "");
        if (!drafts.some((other) => other !== draft && normalizeCue(other.senseCue ?? "") === key))
          continue;
        draft.senseCue = await this.promptRequiredCue(
          structuredCopy.draftLabel(draft.index + 1),
          drafts,
          cueSet([draft.senseCue, ...otherDraftCues(drafts, draft)]),
        );
      }
    }
  }

  private async persistGroup(
    drafts: Draft[],
    existing: Entry[],
    missingExistingIds: ReadonlySet<number>,
    actions: DraftAction[],
  ): Promise<GroupResult> {
    const results: Entry[] = [];
    for (const entry of existing.filter(
      (candidate) => missingExistingIds.has(candidate.id) && hasCue(candidate.senseCue),
    )) {
      const updated = await this.ctx.api.updateEntry(
        entry.id,
        entry.revision,
        { senseCue: entry.senseCue },
        {
          term: drafts[0]!.term,
          senseCue: entry.senseCue,
        },
      );
      results.push(updated.entry);
    }
    for (const [index, draft] of drafts.entries()) {
      const action = actions[index]!;
      if (action.kind === "skip") continue;
      await this.reconcileForms(draft);
      results.push(await this.persist(draft, action));
    }
    return results.length === 0
      ? { handled: false, abortBatch: false, entries: [] }
      : { handled: true, abortBatch: false, entries: results };
  }

  async run(defaultsList: PromptDefaults[]): Promise<boolean> {
    let handledAny = false;
    const rendered: Entry[] = [];
    try {
      const prepared = await Promise.all(
        defaultsList.map((defaults) =>
          this.ctx.api.prepare(typeof defaults.term === "string" ? defaults.term.trim() : ""),
        ),
      );
      const groups = groupDrafts(defaultsList, prepared);
      for (const group of groups.values()) {
        const result = await this.resolveGroup(group.drafts, group.matches);
        handledAny ||= result.handled;
        for (const entry of result.entries) {
          const at = rendered.findIndex((candidate) => candidate.id === entry.id);
          if (at === -1) rendered.push(entry);
          else rendered[at] = entry;
        }
        if (result.abortBatch) break;
        this.io.view("-".repeat(40) + "\n");
      }
    } catch (error) {
      if (isPromptAbort(error)) {
        this.io.clearScreen();
        this.io.view(structuredCopy.cancelled);
        return handledAny;
      }
      if (error instanceof CliError) {
        // Nothing saved yet: let the prompt loop keep the pasted input for a retry.
        if (!handledAny && (error.kind === "network" || error.kind === "auth")) throw error;
        this.io.view(error.message);
        return handledAny;
      }
      throw error;
    }
    if (rendered.length > 0) {
      this.io.clearScreen();
      for (const entry of rendered) await this.render(entry);
    }
    return handledAny;
  }
}
