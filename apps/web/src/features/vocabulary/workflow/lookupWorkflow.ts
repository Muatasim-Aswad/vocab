import { isUnauthorized } from "../../session/index.ts";
import type { RelationDraft } from "../draft.ts";
import { describeError, type Problem } from "../errors.ts";
import type { EntryDetail, EntrySummary, Prepared } from "../types.ts";
import { pendingWrite } from "./state.ts";
import { revisions } from "./state.ts";
import type { DraftState, StoreDeps } from "./types.ts";

interface LookupHost {
  getState(): DraftState;
  set(patch: Partial<DraftState>): void;
  focusField(id: string): DraftState["focus"];
}

const summaryOf = (detail: EntryDetail): EntrySummary => ({
  id: detail.entry.id,
  revision: detail.entry.revision,
  lemma: detail.entry.lemma,
  ...(detail.entry.status && { status: detail.entry.status }),
  ...(detail.entry.senseCue && { senseCue: detail.entry.senseCue }),
  ...(detail.entry.partOfSpeech && { partOfSpeech: detail.entry.partOfSpeech }),
  ...(detail.entry.extra && { extra: detail.entry.extra }),
});

/** Prepares terms and resolves relation targets for the owning draft. */
export class LookupWorkflow {
  private readonly host: LookupHost;
  constructor(host: LookupHost) {
    this.host = host;
  }
  private get state() {
    return this.host.getState();
  }
  private set(patch: Partial<DraftState>) {
    this.host.set(patch);
  }
  private focusField(id: string) {
    return this.host.focusField(id);
  }
  async fetchPreparation(deps: StoreDeps, term: string): Promise<Prepared | undefined> {
    const request = {};
    this.set({ lookup: { status: "preparing", request } });
    try {
      const result = await deps.api.prepareEntry({ term });
      // A later request or draft change makes this response obsolete, even for the same term.
      if (!this.isCurrentPreparation(request, term)) return undefined;
      const add = this.state;
      this.set({
        preparation: { term, result },
        ...((add.draft.addMeaning || add.draft.editId !== null) &&
          add.meaningBasis === null && { meaningBasis: revisions(result.matches) }),
      });
      return result;
    } catch (error) {
      if (!this.isCurrentPreparation(request, term)) return undefined;
      throw error;
    } finally {
      const lookup = this.state.lookup;
      if (lookup.status === "preparing" && lookup.request === request)
        this.set({ lookup: { status: "idle" } });
    }
  }

  private isCurrentPreparation(request: object, term: string): boolean {
    const { draft, lookup } = this.state;
    return (
      lookup.status === "preparing" && lookup.request === request && draft.term.trim() === term
    );
  }

  /** Checks a confirmed term's existing meanings and suggestions, read-only. */
  prepare = async (deps: StoreDeps) => {
    const { draft, preparation, termConfirmed, lookup } = this.state;
    const pending = pendingWrite(this.state);

    const term = draft.term.trim();
    if (
      !term ||
      !termConfirmed ||
      pending ||
      lookup.status === "preparing" ||
      preparation?.term === term
    )
      return;
    this.set({ lookup: { status: "idle" } });
    try {
      const prepared = await this.fetchPreparation(deps, term);
      if (prepared?.formOf.length) this.set({ focus: this.focusField("form-of") });
      else if (prepared?.matches.length) this.set({ focus: this.focusField("meanings") });
    } catch (error) {
      if (isUnauthorized(error)) deps.onUnauthorized();
      if (this.state.draft.term.trim() === term)
        this.set({ lookup: { status: "failed", problem: describeError(error) } });
    }
  };

  /** Looks up a related word's entries; a failed lookup returns why. */
  lookupRelation = async (deps: StoreDeps, key: string): Promise<Problem | undefined> => {
    const relation = this.state.draft.relations.find((item) => item.key === key);
    const term = relation?.term.trim();
    if (!relation || !term || pendingWrite(this.state)) return undefined;
    this.replaceLookup(key, term, { status: "loading", term });
    try {
      const details = await deps.api.lookupEntry(term);
      const candidates = details.map(summaryOf);
      this.replaceLookup(
        key,
        term,
        candidates.length === 0
          ? { status: "new", term }
          : candidates.length === 1
            ? { status: "resolved", term, target: candidates[0]!, candidates }
            : { status: "choose", term, candidates },
      );
    } catch (error) {
      if (isUnauthorized(error)) deps.onUnauthorized();
      this.replaceLookup(key, term, { status: "failed", term });
      return describeError(error);
    }
    return undefined;
  };

  chooseRelationTarget = (key: string, targetId: number) => {
    const relation = this.state.draft.relations.find((item) => item.key === key);
    const lookup = relation?.lookup;
    if (!relation || !lookup || !("candidates" in lookup)) return;
    const target = lookup.candidates.find((candidate) => candidate.id === targetId);
    if (!target) return;
    this.replaceLookup(key, relation.term.trim(), {
      status: "resolved",
      term: lookup.term,
      target,
      candidates: lookup.candidates,
    });
    const { [`relation-${key}`]: _removed, ...errors } = this.state.errors;
    this.set({ errors, changed: true });
  };

  private replaceLookup(key: string, term: string, lookup: RelationDraft["lookup"]) {
    const { draft } = this.state;
    const relations = draft.relations.map((relation) =>
      relation.key === key && relation.term.trim() === term ? { ...relation, lookup } : relation,
    );
    this.set({ draft: { ...draft, relations } });
  }
}
