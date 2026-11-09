import { uuidV7 } from "../../../shared/uuid.ts";
import { isUnauthorized } from "../../session/index.ts";
import { aiProvenance, isReviewing } from "../aiDraft.ts";
import {
  buildCreateBody,
  buildEditBody,
  currentPreparation,
  editTarget,
  isStub,
  validateDraft,
  type RelationDraft,
} from "../draft.ts";
import { describeError, isCaptureRejection, mayHaveCommitted, type Problem } from "../errors.ts";
import type { EntryDetail, Prepared } from "../types.ts";
import type { AiWorkflow } from "./aiWorkflow.ts";
import { initialDraft, pendingWrite, revisions, sameRevisions } from "./state.ts";
import type { DraftState, EntryWrite, Notice, Pending, StoreDeps } from "./types.ts";

const saveTimeoutMs = 20_000;

interface SaveHost {
  getState(): DraftState;
  set(patch: Partial<DraftState>): void;
  focusField(id: string): DraftState["focus"];
  fail(errors: Record<string, string>, notice?: Notice | null): void;
  fetchPreparation(deps: StoreDeps, term: string): Promise<Prepared | undefined>;
  lookupRelation(deps: StoreDeps, key: string): Promise<Problem | undefined>;
  aiWorkflow: AiWorkflow;
}

function withoutCapture(write: EntryWrite, mutationId: string): EntryWrite {
  if (write.kind === "create") {
    const { captureId: _removed, ...body } = write.body;
    return { kind: "create", body: { ...body, mutationId } };
  }
  const { captureId: _removed, ...body } = write.body;
  return { ...write, body: { ...body, mutationId } };
}

/** Validates, submits, and reconciles writes for the owning draft. */
export class SaveWorkflow {
  private readonly host: SaveHost;
  constructor(host: SaveHost) {
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
  private fail(errors: Record<string, string>, notice?: Notice | null) {
    return this.host.fail(errors, notice);
  }
  private fetchPreparation(deps: StoreDeps, term: string) {
    return this.host.fetchPreparation(deps, term);
  }
  private lookupRelation(deps: StoreDeps, key: string) {
    return this.host.lookupRelation(deps, key);
  }
  /** Save the draft, or reconcile the unresolved submission with its original identity. */
  save = async (deps: StoreDeps) => {
    const add = this.state;
    const pending = pendingWrite(add);
    if (pending) {
      if (pending.status !== "saving") await this.send(deps);
      return;
    }
    if (add.operation.status === "checking") return;
    const basic = validateDraft(add.draft, null);
    if (basic.term) return this.fail({ term: basic.term });

    this.set({ operation: { status: "checking" }, notice: null, errors: {} });
    const term = add.draft.term.trim();
    let prepared: Prepared | undefined;
    try {
      prepared = await this.fetchPreparation(deps, term);
    } catch (error) {
      if (isUnauthorized(error)) {
        this.fail({}, { kind: "unauthorized" });
        this.set({ operation: { status: "awaitingLogin" }, notice: null });
        deps.onUnauthorized();
        return;
      }
      const problem = describeError(error);
      if (problem.field === "term") return this.fail({ term: problem.key });
      return this.fail({}, { kind: "notSent", key: problem.key, requestId: problem.requestId });
    }
    if (!prepared) return this.set({ operation: { status: "idle" } });

    const current = this.state;
    const target = editTarget(current.draft, prepared);
    // The edited entry is no longer a meaning of its term; it is never saved as a new one.
    if (current.draft.editId !== null && !target)
      return this.fail(
        { meanings: "vocab.error.meaningsChanged" },
        { kind: "meaningsChanged", key: "vocab.error.meaningsChanged" },
      );
    if (prepared.matches.length && !current.draft.addMeaning && !target)
      return this.fail({ meanings: "vocab.add.error.chooseMeaning" }, { kind: "exists" });
    if (
      prepared.matches.length &&
      (current.draft.addMeaning || target) &&
      !sameRevisions(current.meaningBasis, prepared.matches)
    ) {
      this.set({ meaningBasis: revisions(prepared.matches) });
      return this.fail(
        { meanings: "vocab.error.meaningsChanged" },
        { kind: "meaningsChanged", key: "vocab.error.meaningsChanged" },
      );
    }

    // Unchecked related terms, and those whose lookup failed, are looked up now; ambiguous ones
    // need review first, and so do new ones, unless a suggestion is accepted as shown.
    const accepting = isReviewing(current.ai, current.aiSource);
    const needsReview = (relation: RelationDraft) =>
      relation.lookup.status !== "resolved" && !(accepting && relation.lookup.status === "new");
    const unchecked = current.draft.relations.filter(
      (relation) =>
        relation.term.trim() &&
        (relation.lookup.status === "idle" || relation.lookup.status === "failed"),
    );
    if (unchecked.length) {
      const problems = await Promise.all(
        unchecked.map((relation) => this.lookupRelation(deps, relation.key)),
      );
      const reviewed = this.state.draft.relations.filter((relation) =>
        unchecked.some((item) => item.key === relation.key),
      );
      const problem = problems.find(Boolean);
      const choosing = reviewed.some((relation) => relation.lookup.status === "choose");
      if (accepting && problem && !choosing)
        return this.fail({}, { kind: "notSent", key: problem.key, requestId: problem.requestId });
      if (reviewed.some(needsReview)) {
        const errors = validateDraft(this.state.draft, this.state.preparation);
        return this.fail(
          Object.keys(errors).length ? errors : { relations: "vocab.add.error.reviewRelations" },
          { kind: "reviewRelations" },
        );
      }
    }

    const latest = this.state;
    const errors = validateDraft(latest.draft, latest.preparation);
    if (Object.keys(errors).length) return this.fail(errors);

    const write = this.buildWrite(latest);
    this.set({
      operation: {
        write,
        term: latest.draft.term.trim(),
        status: "saving",
        suggestion: latest.aiSource?.key ?? null,
      },
    });
    await this.send(deps);
  };

  /**
   * The request for a validated draft; the linked capture goes with it, and an AI
   * suggestion's provenance goes with the write it causes.
   */
  private buildWrite(add: DraftState): EntryWrite {
    const mutationId = uuidV7();
    const captureId = add.capture ? { captureId: add.capture.id } : {};
    const provenance = aiProvenance(add.aiSource);
    const ai = provenance ? { ai: provenance } : {};
    const target = editTarget(add.draft, currentPreparation(add.draft, add.preparation));
    if (!target)
      return {
        kind: "create",
        body: {
          ...buildCreateBody(add.draft, add.preparation, mutationId, add.aiSource !== null),
          ...captureId,
          ...ai,
        },
      };
    return {
      kind: "edit",
      id: target.id,
      stub: isStub(target),
      body: {
        ...buildEditBody(add.draft, add.preparation, target, mutationId),
        ...captureId,
        ...ai,
      },
    };
  }

  private request(deps: StoreDeps, write: EntryWrite): Promise<EntryDetail> {
    const options = { signal: AbortSignal.timeout(saveTimeoutMs) };
    return write.kind === "create"
      ? deps.api.createEntry(write.body, options)
      : deps.api.updateEntry(write.id, write.body, options);
  }

  /**
   * The API refused to consume the linked capture (removed meanwhile, or the saved word differs),
   * so nothing was written. The same entry is sent again, as a new write, without the capture.
   */
  private async resendWithoutCapture(deps: StoreDeps, pending: Pending) {
    const write = withoutCapture(pending.write, uuidV7());
    const kept = this.state.capture?.term ?? null;
    this.set({ capture: null, operation: { ...pending, write } });
    await this.send(deps, kept);
  }

  /**
   * After login, resend an unresolved submission with its original identity, or continue a save
   * that stopped for authentication before anything was sent.
   */
  reconcile = async (deps: StoreDeps) => {
    const { operation, ai } = this.state;
    const pending = pendingWrite(this.state);
    if (ai?.status === "unauthorized") void this.host.aiWorkflow.runGeneration(deps);
    this.host.aiWorkflow.redeliver(deps);
    if (pending && pending.status !== "saving") await this.send(deps);
    else if (operation.status === "awaitingLogin") {
      this.set({ operation: { status: "idle" } });
      await this.save(deps);
    }
  };

  private async send(deps: StoreDeps, captureKept: string | null = null) {
    const pending = pendingWrite(this.state);
    if (!pending) return;
    const { write, term, suggestion } = pending;
    this.set({ operation: { write, term, suggestion, status: "saving" }, notice: null });
    try {
      const saved = await this.request(deps, pending.write);
      this.set({
        ...initialDraft,
        ai: this.host.aiWorkflow.withSaved(pending.suggestion, saved),
        saved,
      });
      deps.onSaved({
        saved,
        savedAs:
          pending.write.kind === "create" ? "added" : pending.write.stub ? "completed" : "updated",
        captureKept,
      });
      await this.host.aiWorkflow.continueSuggestions(deps, pending.suggestion);
    } catch (error) {
      if (pending.write.body.captureId && isCaptureRejection(error))
        return this.resendWithoutCapture(deps, pending);
      if (isUnauthorized(error)) {
        this.set({
          operation: { write, term, suggestion, status: "unauthorized" },
          notice: null,
        });
        deps.onUnauthorized();
        return;
      }
      const problem = describeError(error);
      if (mayHaveCommitted(error)) {
        this.set({
          operation: { write, term, suggestion, status: "uncertain", problem },
          notice: null,
          focus: this.focusField("notice"),
        });
        return;
      }
      // The API rejected the request, so nothing was written; the draft becomes editable again.
      this.set({ operation: { status: "idle" } });
      const field = problem.field;
      // Meaning conflicts come from concurrent writes; show the current meanings again.
      if (field === "meanings" || field === "senseCue")
        void this.fetchPreparation(deps, pending.term).catch(() => undefined);
      this.fail(field ? { [field]: problem.key } : {}, {
        kind: problem.key === "vocab.error.meaningsChanged" ? "meaningsChanged" : "rejected",
        key: problem.key,
        requestId: problem.requestId,
      });
    }
  }
}
