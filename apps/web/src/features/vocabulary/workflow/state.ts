import { emptyDraft } from "../draft.ts";
import type { EntrySummary, MeaningMatch, Prepared } from "../types.ts";
import type { DraftState, Notice } from "./types.ts";

export const initialDraft: DraftState = {
  draft: emptyDraft,
  changed: false,
  termConfirmed: false,
  lookup: { status: "idle" },
  loadingEdit: false,
  preparation: null,
  meaningBasis: null,
  errors: {},
  notice: null,
  operation: { status: "idle" },
  saved: null,
  capture: null,
  focus: null,
  ai: null,
  aiSource: null,
  aiRequested: false,
  aiFinished: null,
};

export const isMeaningField = (field: string) =>
  field === "meanings" || field === "senseCue" || field.startsWith("backfill-");

export const revisions = (matches: Array<Pick<EntrySummary, "id" | "revision">>) =>
  Object.fromEntries(matches.map((match) => [match.id, match.revision]));

export function sameRevisions(
  basis: Record<number, number> | null,
  matches: EntrySummary[],
): boolean {
  if (!basis || Object.keys(basis).length !== matches.length) return false;
  return matches.every((match) => basis[match.id] === match.revision);
}

export const withRevision = (matches: EntrySummary[], id: number, revision: number) => ({
  ...revisions(matches),
  [id]: revision,
});

/** The open suggestion's recommendation, while the meanings it compared are unchanged. */
export function freshMatch(
  state: DraftState,
  prepared: Prepared | undefined,
): MeaningMatch | undefined {
  const match = state.aiSource ? state.ai?.matches[state.aiSource.key] : undefined;
  if (match?.status !== "ready" || !prepared) return undefined;
  return sameRevisions(revisions(match.match.compared), prepared.matches) ? match.match : undefined;
}

/** A sent write remains locked until its outcome is known. */
export function pendingWrite(state: DraftState) {
  const operation = state.operation;
  return operation.status === "saving" ||
    operation.status === "uncertain" ||
    operation.status === "unauthorized"
    ? operation
    : null;
}

export const isChecking = (state: DraftState) => state.operation.status === "checking";

/** A sent write or stopped authentication owns its notice and retry state. */
export function saveNotice(state: DraftState): Notice | null {
  const operation = state.operation;
  if (operation.status === "uncertain")
    return {
      kind: "uncertain",
      key: operation.problem.key,
      requestId: operation.problem.requestId,
    };
  if (operation.status === "unauthorized" || operation.status === "awaitingLogin")
    return { kind: "unauthorized" };
  return state.notice;
}
