import { uuidV7 } from "../../../shared/uuid.ts";
import { isUnauthorized } from "../../session/index.ts";
import {
  draftForSameMeaning,
  draftFromAi,
  existingSenses,
  isReviewing,
  meaningCandidate,
  newSession,
  ownDraft,
  suggestionsFrom,
  type AiSession,
  type Delivery,
  type MatchState,
  type Stashed,
  type Suggestion,
} from "../aiDraft.ts";
import {
  currentPreparation,
  editableSnapshot,
  emptyDraft,
  isDraftEmpty,
  validateDraft,
  type Draft,
  type Preparation,
} from "../draft.ts";
import { describeError } from "../errors.ts";
import type { EntryDetail, Prepared } from "../types.ts";
import { isChecking, pendingWrite } from "./state.ts";
import {
  freshMatch,
  isMeaningField,
  revisions,
  sameRevisions,
  withRevision,
  initialDraft,
} from "./state.ts";
import type { DraftState, StoreDeps } from "./types.ts";

const generateTimeoutMs = 100_000;

interface AiHost {
  getState(): DraftState;
  set(patch: Partial<DraftState>): void;
  focusField(id: string): DraftState["focus"];
  editingOpenSuggestion(): Partial<DraftState>;
  prepare(deps: StoreDeps): Promise<void>;
}

/** Coordinates generation, suggestion review, and meaning comparison for one draft. */
export class AiWorkflow {
  private readonly comparisons = new Map<string, Promise<void>>();
  private readonly host: AiHost;
  constructor(host: AiHost) {
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
  private editingOpenSuggestion() {
    return this.host.editingOpenSuggestion();
  }
  private prepare(deps: StoreDeps) {
    return this.host.prepare(deps);
  }
  /**
   * After saving a suggestion, the next undecided one opens with its term; any other save ends
   * the AI session.
   */
  async continueSuggestions(deps: StoreDeps, savedKey: string | null) {
    const { ai } = this.state;
    const next = ai && savedKey !== null ? this.nextOpen(savedKey) : undefined;
    if (!ai || !next) return this.set({ ai: null });
    this.set({ draft: { ...emptyDraft, term: ai.request.term }, termConfirmed: true });
    await this.show(deps, next);
  }

  private setAi(patch: Partial<AiSession>, requestId?: string) {
    const { ai } = this.state;
    if (ai && (!requestId || ai.request.requestId === requestId))
      this.set({ ai: { ...ai, ...patch } });
  }

  private updateSuggestion(requestId: string, key: string, patch: Partial<Suggestion>) {
    const { ai } = this.state;
    if (ai?.request.requestId !== requestId) return;
    const suggestions = ai.suggestions.map((item) =>
      item.key === key ? { ...item, ...patch } : item,
    );
    this.set({ ai: { ...ai, suggestions } });
  }

  withSaved(key: string | null, saved: EntryDetail): AiSession | null {
    const { ai } = this.state;
    if (!ai || key === null) return ai;
    const { [key]: _saved, ...stash } = ai.stash;
    const suggestions = ai.suggestions.map((item) =>
      item.key === key
        ? { ...item, saved: { id: saved.entry.id, lemma: saved.entry.lemma } }
        : item,
    );
    return { ...ai, stash, suggestions };
  }

  /** Asks for AI suggestions for the checked term and opens the first; never automatic. */
  generate = async (deps: StoreDeps) => {
    const { draft, preparation, ai, aiSource } = this.state;
    const pending = pendingWrite(this.state);

    const prepared = currentPreparation(draft, preparation);
    if (!prepared || pending || aiSource || ai?.status === "generating") return;
    const allowExisting = prepared.matches.length > 0;
    const excludeSenses = existingSenses(prepared);
    this.set({
      aiRequested: false,
      ai: newSession(
        {
          requestId: uuidV7(),
          term: draft.term.trim(),
          allowExisting,
          ...(excludeSenses.length && { excludeSenses }),
        },
        prepared.matches.map((match) => match.id),
      ),
    });
    await this.runGeneration(deps);
  };

  /** Sends the same generation request again, so a response that was lost is replayed. */
  retryGeneration = async (deps: StoreDeps) => {
    const status = this.state.ai?.status;
    if (status === "failed" || status === "unauthorized") await this.runGeneration(deps);
  };

  async runGeneration(deps: StoreDeps) {
    const request = this.state.ai?.request;
    if (!request) return;
    const current = () => this.state.ai?.request.requestId === request.requestId;
    this.setAi({ status: "generating", problem: null });
    try {
      const generated = await deps.api.generateDraft(request, {
        signal: AbortSignal.timeout(generateTimeoutMs),
      });
      if (!current()) return;
      if (!generated.drafts.length) {
        this.setAi({ status: "existing" });
        // The term gained meanings since it was checked; show them again.
        if (this.state.draft.term.trim() === request.term) {
          this.set({ preparation: null });
          await this.prepare(deps);
        }
        return;
      }
      const suggestions = suggestionsFrom(generated.drafts, request.requestId, () => uuidV7());
      this.setAi({
        status: "ready",
        generationId: generated.generationId ?? null,
        suggestions,
      });
      for (const suggestion of suggestions.slice(1)) void this.prefetchMatch(deps, suggestion.key);
      await this.show(deps, suggestions[0]!.key);
    } catch (error) {
      if (!current()) return;
      const unauthorized = isUnauthorized(error);
      this.setAi({
        status: unauthorized ? "unauthorized" : "failed",
        problem: describeError(error),
      });
      if (unauthorized) deps.onUnauthorized();
    }
  }

  /** Records that a suggestion is in the form; repeated calls send its one event once. */
  present = (deps: StoreDeps, key: string) => this.deliver(deps, key, "presented");

  private async deliver(deps: StoreDeps, key: string, kind: "presented" | "skipped") {
    const { ai } = this.state;
    const suggestion = ai?.suggestions.find((item) => item.key === key);
    const delivery = suggestion?.[kind];
    if (!ai || !suggestion?.draftId || !delivery) return;
    if (delivery.status === "sending" || delivery.status === "sent") return;
    const { eventId } = delivery;
    const update = (next: Delivery) =>
      this.updateSuggestion(
        ai.request.requestId,
        key,
        kind === "presented" ? { presented: next } : { skipped: next },
      );
    update({ eventId, status: "sending" });
    try {
      await deps.api.recordAiDraftEvent({ eventId, draftId: suggestion.draftId, eventType: kind });
      update({ eventId, status: "sent" });
    } catch (error) {
      if (isUnauthorized(error)) deps.onUnauthorized();
      update({ eventId, status: "failed" });
    }
  }

  /** Resends events the API did not confirm, under their original IDs. */
  redeliver(deps: StoreDeps) {
    for (const item of this.state.ai?.suggestions ?? []) {
      if (item.presented.status === "failed") void this.deliver(deps, item.key, "presented");
      if (item.skipped?.status === "failed") void this.deliver(deps, item.key, "skipped");
    }
  }

  /** The suggestion after `key` that is neither saved nor skipped, wrapping around. */
  private nextOpen(key: string | null, backwards = false): string | undefined {
    const all = this.state.ai?.suggestions ?? [];
    const suggestions = backwards ? all.toReversed() : all;
    const start = suggestions.findIndex((item) => item.key === key);
    const ordered = [...suggestions.slice(start + 1), ...suggestions.slice(0, start + 1)];
    return ordered.find((item) => item.key !== key && !item.saved && !item.skipped)?.key;
  }

  /** Opens the next undecided suggestion; the current one keeps its edits. */
  nextSuggestion = async (deps: StoreDeps) => {
    const next = this.nextOpen(this.state.aiSource?.key ?? null);
    if (next) await this.show(deps, next);
  };

  /** Opens the previous undecided suggestion; the current one keeps its edits. */
  previousSuggestion = async (deps: StoreDeps) => {
    const previous = this.nextOpen(this.state.aiSource?.key ?? null, true);
    if (previous) await this.show(deps, previous);
  };

  /**
   * Skips the open suggestion explicitly, then opens the next undecided one. Skipping the last one
   * ends the session, keeping the user's own draft only when it holds more than the term. Leaving
   * by navigation records nothing.
   */
  skip = async (deps: StoreDeps) => {
    const { ai, aiSource } = this.state;
    const pending = pendingWrite(this.state);
    const checking = isChecking(this.state);
    if (!ai || !aiSource || pending || checking || ai.opening) return;
    const { key } = aiSource;
    this.redeliver(deps);
    const session = this.state.ai!;
    const suggestions = session.suggestions.map((item) =>
      item.key === key
        ? { ...item, skipped: { eventId: uuidV7(), status: "idle" as const } }
        : item,
    );
    this.set({ ai: { ...session, suggestions } });
    void this.deliver(deps, key, "skipped");
    const next = this.nextOpen(key);
    if (next) return this.show(deps, next);
    const own = session.stash[ownDraft];
    const { capture } = this.state;
    this.set({
      ...initialDraft,
      ...(own &&
        !isDraftEmpty({ ...own.draft, term: "" }) && {
          draft: own.draft,
          meaningBasis: own.meaningBasis,
          termConfirmed: true,
          capture,
        }),
      aiFinished: {},
    });
  };

  private setMatch(requestId: string, key: string, match: MatchState) {
    const { ai } = this.state;
    if (ai?.request.requestId === requestId)
      this.set({ ai: { ...ai, matches: { ...ai.matches, [key]: match } } });
  }

  /**
   * Asks AI whether a suggestion is one of its term's meanings the user has not seen, once per
   * suggestion unless those meanings changed since; nothing is asked for a suggestion without
   * notes or examples. Resolves when the recommendation, or its failure, is recorded.
   */
  private compare(deps: StoreDeps, key: string, prepared: Prepared): Promise<void> | undefined {
    const { ai } = this.state;
    const suggestion = ai?.suggestions.find((item) => item.key === key);
    if (!ai || !suggestion) return undefined;
    if (prepared.matches.every((match) => ai.known.includes(match.id))) return undefined;
    const draft = meaningCandidate(suggestion.draft);
    if (!draft) return undefined;
    const known = ai.matches[key];
    if (
      known?.status === "ready" &&
      sameRevisions(revisions(known.match.compared), prepared.matches)
    )
      return undefined;
    const running = this.comparisons.get(key);
    if (running) return running;
    const { requestId } = ai.request;
    this.setMatch(requestId, key, { status: "loading" });
    const comparison = deps.api
      .matchMeaning(
        {
          requestId: uuidV7(),
          ...(suggestion.draftId && { draftId: suggestion.draftId }),
          draft,
          entryIds: prepared.matches.map((match) => match.id),
        },
        { signal: AbortSignal.timeout(generateTimeoutMs) },
      )
      .then((match) => this.setMatch(requestId, key, { status: "ready", match }))
      .catch((error: unknown) => {
        if (isUnauthorized(error)) deps.onUnauthorized();
        this.setMatch(requestId, key, { status: "failed" });
      })
      .finally(() => this.comparisons.delete(key));
    this.comparisons.set(key, comparison);
    return comparison;
  }

  /** Checks a suggestion's term and compares it in the background, so it opens with its recommendation. */
  private async prefetchMatch(deps: StoreDeps, key: string) {
    const suggestion = this.state.ai?.suggestions.find((item) => item.key === key);
    if (!suggestion) return;
    try {
      const prepared = await deps.api.prepareEntry({ term: suggestion.draft.term.trim() });
      await this.compare(deps, key, prepared);
    } catch (error) {
      if (isUnauthorized(error)) deps.onUnauthorized();
    }
  }

  /**
   * Labels a "new meaning" recommendation gives: the suggestion's own label unless the user changed
   * it, and those of unlabeled meanings the user left empty.
   */
  private recommendedLabels(prepared: Prepared): Partial<Draft> {
    const { draft, ai, aiSource } = this.state;
    const match = freshMatch(this.state, prepared);
    if (match?.decision !== "new") return {};
    const suggested = ai?.suggestions.find((item) => item.key === aiSource?.key)?.draft.senseCue;
    const untouched = draft.senseCue.trim() === (suggested?.trim() ?? "");
    const backfills = { ...draft.backfills };
    for (const { id, senseCue } of match.backfills)
      if (!backfills[id]?.trim()) backfills[id] = senseCue;
    return { ...(untouched && { senseCue: match.senseCue }), backfills };
  }

  /**
   * The open suggestion is another meaning of its term: it goes straight to review when no label
   * is missing, and to the labels otherwise.
   */
  newMeaning = () => {
    const { draft, preparation, aiSource } = this.state;
    const pending = pendingWrite(this.state);
    const checking = isChecking(this.state);
    const prepared = currentPreparation(draft, preparation);
    if (!aiSource || !prepared || pending || checking) return;
    const labeled = {
      ...draft,
      ...this.recommendedLabels(prepared),
      addMeaning: true,
      editId: null,
    };
    const meaningsConfirmed = Object.keys(validateDraft(labeled, preparation)).every(
      (field) => !isMeaningField(field),
    );
    this.set({
      draft: { ...labeled, meaningsConfirmed },
      meaningBasis: revisions(prepared.matches),
      errors: {},
      notice: null,
      ...(!meaningsConfirmed && this.editingOpenSuggestion()),
      focus: this.focusField(meaningsConfirmed ? "suggestion" : "senseCue"),
    });
  };

  /**
   * The open suggestion is the meaning of an existing entry, which it completes: a stub shows as
   * the entry Accept saves, an active entry opens in the form with the values it replaced noted.
   */
  sameMeaning = async (deps: StoreDeps, id: number) => {
    const { ai, aiSource, draft, preparation } = this.state;
    const pending = pendingWrite(this.state);
    const checking = isChecking(this.state);
    const suggestion = ai?.suggestions.find((item) => item.key === aiSource?.key);
    const prepared = currentPreparation(draft, preparation);
    if (!ai || !aiSource || !suggestion || !prepared || pending || checking || ai.opening) return;
    const { key } = aiSource;
    const { requestId } = ai.request;
    this.setAi({ opening: key, openProblem: null });
    let detail: EntryDetail;
    try {
      detail = await deps.api.getEntry(id);
    } catch (error) {
      if (isUnauthorized(error)) deps.onUnauthorized();
      this.setAi({ opening: null, openProblem: describeError(error) }, requestId);
      return;
    }
    if (this.state.ai?.request.requestId !== requestId || this.state.ai.opening !== key) return;
    this.setAi({ opening: null });
    if (pendingWrite(this.state) || this.state.aiSource?.key !== key) return;
    const next = draftForSameMeaning(suggestion.draft, key, detail);
    const stub = detail.entry.status === "stub";
    this.set({
      draft: next,
      changed: true,
      meaningBasis: withRevision(prepared.matches, id, detail.entry.revision),
      aiSource: { ...aiSource, editableBaseline: editableSnapshot(next, this.state.preparation) },
      errors: {},
      notice: null,
      ...(!stub && this.editingOpenSuggestion()),
      focus: this.focusField(stub ? "suggestion" : "examples"),
    });
  };

  /**
   * Puts a suggestion in the form. Its term is checked first, so the baseline holds the form after
   * conversion and API suggestions, before any change by the user. For a term whose meanings the
   * user already chose to add to it is another meaning, and goes straight to the fields when no
   * label is missing; other meanings may be the same one, so the user chooses first.
   */
  private async show(deps: StoreDeps, key: string) {
    const { ai, saved, aiSource } = this.state;
    const pending = pendingWrite(this.state);
    const checking = isChecking(this.state);
    const suggestion = ai?.suggestions.find((item) => item.key === key);
    if (!ai || !suggestion || suggestion.saved || suggestion.skipped || pending || checking) return;
    if (ai.opening || ai.comparing || (aiSource?.key === key && !saved)) return;
    this.redeliver(deps);
    const stashed = ai.stash[key];
    if (stashed) return this.switchTo(key, stashed);
    const term = suggestion.draft.term.trim();
    const { requestId } = ai.request;
    const known = this.state.preparation;
    let result = known?.term === term ? known.result : undefined;
    if (!result) {
      this.setAi({ opening: key, openProblem: null });
      try {
        result = await deps.api.prepareEntry({ term });
      } catch (error) {
        if (isUnauthorized(error)) deps.onUnauthorized();
        this.setAi({ opening: null, openProblem: describeError(error) }, requestId);
        return;
      }
      if (this.state.ai?.request.requestId !== requestId || this.state.ai.opening !== key) return;
      this.setAi({ opening: null });
      if (pendingWrite(this.state)) return;
    }
    const comparison = this.compare(deps, key, result);
    if (comparison) {
      this.setAi({ comparing: key });
      await comparison;
      if (this.state.ai?.request.requestId !== requestId || this.state.ai.comparing !== key) return;
      this.setAi({ comparing: null });
      if (pendingWrite(this.state)) return;
    }
    const preparation = { term, result };
    const converted = draftFromAi(suggestion.draft, key);
    // Meanings the user has not seen yet may be this one, so the user decides first.
    const addMeaning =
      result.matches.length > 0 &&
      result.matches.every((match) => this.state.ai!.known.includes(match.id));
    const labeled = { ...converted, addMeaning };
    const draft = {
      ...labeled,
      meaningsConfirmed:
        addMeaning &&
        Object.keys(validateDraft(labeled, preparation)).every((field) => !isMeaningField(field)),
    };
    this.switchTo(
      key,
      {
        draft,
        meaningBasis: addMeaning ? revisions(result.matches) : null,
        aiSource: {
          key,
          generationId: this.state.ai!.generationId,
          draftId: suggestion.draftId,
          editableBaseline: editableSnapshot(draft, preparation),
        },
      },
      preparation,
    );
  }

  /** Replaces the form, setting aside the current draft unless it was saved or skipped. */
  private switchTo(key: string | null, next: Stashed, preparation?: Preparation) {
    const { ai, draft, aiSource, meaningBasis, saved } = this.state;
    if (!ai) return;
    const { [key ?? ownDraft]: _opened, ...stash } = ai.stash;
    const leaving = ai.suggestions.find((item) => item.key === aiSource?.key);
    const keep = !saved && (!aiSource || (leaving && !leaving.saved && !leaving.skipped));
    const kept = keep
      ? { ...stash, [aiSource?.key ?? ownDraft]: { draft, aiSource, meaningBasis } }
      : stash;
    const prepared = currentPreparation(next.draft, preparation ?? this.state.preparation);
    const labeling = next.draft.addMeaning && !next.draft.meaningsConfirmed;
    const choosing =
      Boolean(prepared?.matches.length) && !next.draft.addMeaning && next.draft.editId === null;
    const reviewing = !choosing && isReviewing(ai, next.aiSource);
    this.set({
      ai: { ...ai, stash: kept },
      draft: next.draft,
      aiSource: next.aiSource,
      meaningBasis: next.meaningBasis,
      ...(preparation && { preparation }),
      termConfirmed: true,
      saved: null,
      lookup: { status: "idle" },
      errors: {},
      notice: null,
      focus: this.focusField(
        reviewing ? "suggestion" : labeling ? "senseCue" : choosing ? "meanings" : "examples",
      ),
    });
  }
}
