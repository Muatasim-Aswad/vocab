import { isReviewing } from "./aiDraft.ts";
import { currentPreparation } from "./draft.ts";
import type { DraftState } from "./store.ts";
import { pendingWrite } from "./workflow/state.ts";

export const hasUndecided = (add: DraftState) =>
  add.ai?.suggestions.some((item) => !item.saved && !item.skipped) ?? false;

/** Whether the checked term may ask for suggestions: only on request, never on entry. */
export function canSuggest(add: DraftState): boolean {
  const { ai, aiSource, draft } = add;
  const pending = pendingWrite(add);
  if (!currentPreparation(draft, add.preparation) || pending || aiSource) return false;
  if (!ai || ai.request.term !== draft.term.trim()) return true;
  if (ai.status === "existing") return true;
  return ai.status === "ready" && !hasUndecided(add);
}

/** Whether the AI state belongs to what the form shows now. */
export const current = (add: DraftState) =>
  add.ai !== null && (add.aiSource !== null || add.ai.request.term === add.draft.term.trim());

/** AI is generating suggestions, opening one or comparing it, so no form is shown meanwhile. */
export const aiBusy = (add: DraftState) =>
  current(add) &&
  (add.ai!.status === "generating" || add.ai!.opening !== null || add.ai!.comparing !== null);

export const reviewing = (add: DraftState) => isReviewing(add.ai, add.aiSource);
