import { isUnauthorized } from "../session/index.ts";
import {
  currentPreparation,
  draftFromEntry,
  emptyDraft,
  inferableFields,
  isDraftEmpty,
  validateDraft,
  type Draft,
  type InferableField,
  type RelationDraft,
} from "./draft.ts";
import { describeError } from "./errors.ts";
import {
  initialDraft,
  isChecking,
  isMeaningField,
  pendingWrite,
  revisions,
  withRevision,
} from "./workflow/state.ts";
export { freshMatch } from "./workflow/state.ts";
export type { CaptureLink, DraftState, StoreDeps, VocabularyState } from "./workflow/types.ts";
import { AiWorkflow } from "./workflow/aiWorkflow.ts";
import { LookupWorkflow } from "./workflow/lookupWorkflow.ts";
import { SaveWorkflow } from "./workflow/saveWorkflow.ts";
import type {
  CaptureLink,
  DraftState,
  Notice,
  StoreDeps,
  VocabularyState,
} from "./workflow/types.ts";

/** In-memory Search state and the Add and Edit drafts, surviving route, language and theme changes. */
export class VocabularyStore {
  readonly add = new DraftStore();
  readonly edit = new DraftStore();
  private state: VocabularyState = { searchOptionsOpen: false, lastSearch: "" };
  private readonly listeners = new Set<() => void>();

  getState = (): VocabularyState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<VocabularyState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get hasUnsavedWork(): boolean {
    return this.add.hasUnsavedWork || this.edit.hasUnsavedWork;
  }

  setSearchOptionsOpen = (open: boolean) => this.set({ searchOptionsOpen: open });
  rememberSearch = (search: string) => {
    if (search !== this.state.lastSearch) this.set({ lastSearch: search });
  };

  /** After login, each draft resends its unresolved submission or continues its stopped save. */
  reconcile = async (deps: StoreDeps) => {
    await Promise.all([this.add.reconcile(deps), this.edit.reconcile(deps)]);
  };
}

/** One draft: the Add form's new entry, or the Edit form's existing entry. */
export class DraftStore {
  private state: DraftState = initialDraft;
  private readonly listeners = new Set<() => void>();
  private focusSeq = 0;
  private openingId: number | null = null;
  private readonly lookupWorkflow = new LookupWorkflow({
    getState: () => this.state,
    set: (patch) => this.set(patch),
    focusField: (id) => this.focusField(id),
  });
  private readonly aiWorkflow = new AiWorkflow({
    getState: () => this.state,
    set: (patch) => this.set(patch),
    focusField: (id) => this.focusField(id),
    editingOpenSuggestion: () => this.editingOpenSuggestion(),
    prepare: (deps) => this.prepare(deps),
  });
  private readonly saveWorkflow = new SaveWorkflow({
    getState: () => this.state,
    set: (patch) => this.set(patch),
    focusField: (id) => this.focusField(id),
    fail: (errors, notice) => this.fail(errors, notice),
    fetchPreparation: (deps, term) => this.lookupWorkflow.fetchPreparation(deps, term),
    lookupRelation: (deps, key) => this.lookupRelation(deps, key),
    aiWorkflow: this.aiWorkflow,
  });

  generate = (deps: StoreDeps) => this.aiWorkflow.generate(deps);
  retryGeneration = (deps: StoreDeps) => this.aiWorkflow.retryGeneration(deps);
  present = (deps: StoreDeps, key: string) => this.aiWorkflow.present(deps, key);
  nextSuggestion = (deps: StoreDeps) => this.aiWorkflow.nextSuggestion(deps);
  previousSuggestion = (deps: StoreDeps) => this.aiWorkflow.previousSuggestion(deps);
  skip = (deps: StoreDeps) => this.aiWorkflow.skip(deps);
  newMeaning = () => this.aiWorkflow.newMeaning();
  sameMeaning = (deps: StoreDeps, id: number) => this.aiWorkflow.sameMeaning(deps, id);

  getState = (): DraftState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<DraftState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private focusField(id: string): DraftState["focus"] {
    return { id, seq: ++this.focusSeq };
  }

  /** An unresolved save, a new entry's content, or changes to an opened entry. */
  get hasUnsavedWork(): boolean {
    const { draft, changed } = this.state;
    const pending = pendingWrite(this.state);
    return pending !== null || (draft.editId === null ? !isDraftEmpty(draft) : changed);
  }

  /** Edits are refused while a submitted payload is unresolved, so it cannot change silently. */
  edit = (patch: Partial<Draft>, touched?: InferableField) => {
    const add = this.state;
    if (pendingWrite(add)) return;
    const termChanged = "term" in patch && patch.term?.trim() !== add.draft.term.trim();
    // A new term starts over: its meanings are checked again.
    const draft = {
      ...add.draft,
      ...patch,
      ...(termChanged && {
        addMeaning: false,
        meaningsConfirmed: false,
        dismissedForms: [],
        editId: null,
        keepTerm: false,
        previous: {},
      }),
    };
    if (touched && inferableFields.includes(touched) && !draft.touched.includes(touched))
      draft.touched = [...draft.touched, touched];
    const errors = { ...add.errors };
    for (const field of Object.keys(patch)) delete errors[field];
    if (termChanged) delete errors.meanings;
    this.set({
      draft,
      changed: true,
      errors,
      saved: null,
      ...(termChanged && {
        termConfirmed: false,
        aiRequested: false,
        ...(!add.aiSource && { ai: null }),
        lookup: { status: "idle" },
        capture: null,
        meaningBasis: null,
        notice:
          add.notice?.kind === "exists" || add.notice?.kind === "meaningsChanged"
            ? null
            : add.notice,
      }),
    });
  };

  editRelation = (key: string, patch: Partial<RelationDraft>) => {
    const { draft, errors } = this.state;
    const relations = draft.relations.map((relation) =>
      relation.key === key
        ? {
            ...relation,
            ...patch,
            // A changed term needs a new lookup.
            ...(patch.term !== undefined &&
              patch.term.trim() !== relation.term.trim() && {
                lookup: { status: "idle" } as const,
              }),
          }
        : relation,
    );
    this.edit({ relations });
    if (pendingWrite(this.state)) return;
    const { [`relation-${key}`]: _removed, ...rest } = errors;
    this.set({ errors: rest });
  };

  setAddMeaning = (addMeaning: boolean) => {
    const add = this.state;
    if (pendingWrite(add)) return;
    const prepared = currentPreparation(add.draft, add.preparation);
    const { meanings: _removed, ...errors } = add.errors;
    this.set({
      draft: {
        ...add.draft,
        addMeaning,
        meaningsConfirmed: false,
        ...(addMeaning && { editId: null }),
      },
      errors,
      notice: add.notice?.kind === "exists" ? null : add.notice,
      meaningBasis: addMeaning && prepared ? revisions(prepared.matches) : null,
      focus: this.focusField(addMeaning ? "senseCue" : "meanings"),
    });
  };

  /** Adds the term although other entries list it among their forms. */
  keepTerm = () => {
    const add = this.state;
    if (pendingWrite(add)) return;
    const prepared = currentPreparation(add.draft, add.preparation);
    this.set({
      draft: { ...add.draft, keepTerm: true },
      focus: this.focusField(prepared?.matches.length ? "meanings" : "examples"),
    });
  };

  /** Submits the term; the page then checks its existing meanings. */
  confirmTerm = () => {
    const add = this.state;
    if (pendingWrite(add) || add.termConfirmed) return;
    if (!add.draft.term.trim()) return this.fail({ term: "vocab.add.error.termRequired" });
    this.set({ termConfirmed: true, lookup: { status: "idle" } });
  };

  /** Submits the term if needed, and asks AI for suggestions once its meanings are resolved. */
  askAi = () => {
    this.confirmTerm();
    if (this.state.termConfirmed) this.set({ aiRequested: true });
  };

  /** Accepts the labels for another meaning, so the fields replace the choice. */
  confirmMeanings = () => {
    const add = this.state;
    if (pendingWrite(add) || !add.draft.addMeaning) return;
    const errors = Object.fromEntries(
      Object.entries(validateDraft(add.draft, add.preparation)).filter(([field]) =>
        isMeaningField(field),
      ),
    );
    if (Object.keys(errors).length) return this.fail(errors);
    this.set({
      draft: { ...add.draft, meaningsConfirmed: true },
      errors: {},
      notice: null,
      focus: this.focusField("examples"),
    });
  };

  /**
   * Replaces the draft with an existing entry by ID, with its current values and the revisions of
   * its term's meanings; a capture reviewed in Add goes with it.
   */
  openEdit = async (deps: StoreDeps, id: number, capture: CaptureLink | null = null) => {
    if (pendingWrite(this.state)) return;
    this.openingId = id;
    this.set({
      ...initialDraft,
      draft: { ...emptyDraft, editId: id },
      termConfirmed: true,
      loadingEdit: true,
      capture,
    });
    try {
      const detail = await deps.api.getEntry(id);
      if (this.openingId !== id) return;
      const term = detail.entry.lemma;
      this.set({ draft: { ...emptyDraft, term, editId: id } });
      const prepared = await this.lookupWorkflow.fetchPreparation(deps, term);
      if (this.openingId !== id || !prepared) return;
      this.set({
        draft: draftFromEntry(term, detail),
        meaningBasis: withRevision(prepared.matches, id, detail.entry.revision),
        focus: this.focusField("examples"),
      });
    } catch (error) {
      if (this.openingId !== id) return;
      if (isUnauthorized(error)) deps.onUnauthorized();
      this.set({ lookup: { status: "failed", problem: describeError(error) } });
    } finally {
      if (this.openingId === id) {
        this.openingId = null;
        this.set({ loadingEdit: false });
      }
    }
  };

  /** Replaces the draft with a new one for `term`, from Search or a captured term. */
  startWithTerm = (term: string, capture: CaptureLink | null = null, withAi = false) => {
    if (pendingWrite(this.state)) return;
    this.set({
      ...initialDraft,
      draft: { ...emptyDraft, term },
      termConfirmed: true,
      capture,
      aiRequested: withAi,
    });
  };

  /** Reviews a captured term in the current draft, which already holds that term. */
  linkCapture = (capture: CaptureLink) => {
    if (pendingWrite(this.state)) return;
    this.set({ capture, termConfirmed: true, saved: null });
  };

  discard = () => {
    if (pendingWrite(this.state)) return;
    this.set({ ...initialDraft, focus: this.focusField("term") });
  };

  prepare = (deps: StoreDeps) => this.lookupWorkflow.prepare(deps);
  lookupRelation = (deps: StoreDeps, key: string) => this.lookupWorkflow.lookupRelation(deps, key);
  chooseRelationTarget = (key: string, targetId: number) =>
    this.lookupWorkflow.chooseRelationTarget(key, targetId);

  /** Failures of the meaning labels reopen them, since the fields have replaced them. */
  private fail(errors: Record<string, string>, notice: Notice | null = null) {
    const first = Object.keys(errors)[0];
    const { draft } = this.state;
    const reopen =
      draft.meaningsConfirmed &&
      (Object.keys(errors).some((field) => isMeaningField(field) && field !== "senseCue") ||
        notice?.kind === "meaningsChanged");
    this.set({
      ...(reopen && { draft: { ...draft, meaningsConfirmed: false } }),
      ...(Object.keys(errors).length > 0 && this.editingOpenSuggestion()),
      errors,
      notice,
      operation: { status: "idle" },
      ...(first && { focus: this.focusField(first) }),
    });
  }

  /**
   * The AI session with the open suggestion moved into the form, where field errors can be fixed;
   * other failures leave it under review, where Accept tries again.
   */
  private editingOpenSuggestion(): Partial<DraftState> {
    const { ai, aiSource } = this.state;
    if (!ai || !aiSource || ai.editing.includes(aiSource.key)) return {};
    return { ai: { ...ai, editing: [...ai.editing, aiSource.key] } };
  }

  /** Opens the suggestion under review in the form. */
  editSuggestion = () => {
    if (pendingWrite(this.state) || isChecking(this.state)) return;
    this.set({ ...this.editingOpenSuggestion(), focus: this.focusField("examples") });
  };

  save = (deps: StoreDeps) => this.saveWorkflow.save(deps);
  reconcile = (deps: StoreDeps) => this.saveWorkflow.reconcile(deps);
}
