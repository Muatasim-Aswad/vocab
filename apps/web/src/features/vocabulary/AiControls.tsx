import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EditIcon, NextIcon, PreviousIcon } from "../../shared/icons.tsx";
import { button, cn, iconButton } from "../../shared/ui.ts";
import { AiButton } from "./AiButton.tsx";
import { canSuggest, current } from "./aiDisplayState.ts";
import { currentPreparation } from "./draft.ts";
import { freshMatch, type DraftState } from "./store.ts";
import { useDraftStore } from "./vocabulary-context.ts";
import { isChecking, pendingWrite } from "./workflow/state.ts";

const barGroup = "flex flex-wrap items-center gap-3 empty:hidden";

/** Each line takes its own row beneath the actions. */
const aiStatus = "basis-full text-sm text-supporting empty:hidden";

/**
 * The pinned header of Add and Edit: text actions at the start, icon actions at the end, and
 * beneath them what AI is doing. Its background reaches the window edges, so scrolled content never
 * shows beside it.
 */
export function ActionBar({
  add,
  start,
  end,
}: {
  add: DraftState;
  start: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-boundary bg-canvas pt-[max(--spacing(3),env(safe-area-inset-top))] pb-3 shadow-[0_0_0_100vmax] shadow-canvas [clip-path:inset(0_-100vmax)]">
      <div className={barGroup}>{start}</div>
      {end ? <div className={cn(barGroup, "ms-auto gap-1")}>{end}</div> : null}
      <AiStatus add={add} />
    </div>
  );
}

/** What AI is doing, or which suggestion is open. */
function AiStatus({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { ai, aiSource } = add;
  const shown = current(add) ? ai : null;
  const index = shown?.suggestions.findIndex((item) => item.key === aiSource?.key) ?? -1;
  const suggestion = shown?.suggestions[index];
  const failed = shown?.status === "failed" || shown?.status === "unauthorized";
  const comparing = shown?.suggestions.find((item) => item.key === shown.comparing);
  const status = shown?.opening
    ? t("vocab.ai.opening")
    : comparing
      ? t("vocab.ai.comparing", { term: comparing.draft.term })
      : shown?.status === "generating"
        ? t("vocab.ai.generating")
        : shown?.status === "existing"
          ? t("vocab.ai.existing", { term: shown.request.term })
          : suggestion
            ? [
                shown.suggestions.length > 1
                  ? t("vocab.ai.position", { position: index + 1, count: shown.suggestions.length })
                  : "",
                suggestion.draft.term === shown.request.term
                  ? ""
                  : t("vocab.ai.corrected", {
                      from: shown.request.term,
                      to: suggestion.draft.term,
                    }),
                shown.matches[suggestion.key]?.status === "failed"
                  ? t("vocab.ai.compareFailed")
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            : "";
  const problem = failed ? shown.problem : shown?.openProblem;
  const recommended =
    suggestion && !add.draft.addMeaning
      ? freshMatch(add, currentPreparation(add.draft, add.preparation))
      : undefined;
  return (
    <>
      <p className={aiStatus} role="status">
        {status}
      </p>
      {recommended ? (
        <p className={aiStatus}>
          {t("vocab.ai.recommended", {
            choice: t(
              recommended.decision === "same" ? "vocab.add.sameMeaning" : "vocab.add.newMeaning",
            ),
            reason: recommended.reason,
          })}
        </p>
      ) : null}
      {problem ? (
        <p className={cn(aiStatus, "font-semibold text-error")} role="alert">
          {t(failed ? "vocab.ai.failed" : "vocab.ai.openFailed")} {t(problem.key)}
        </p>
      ) : null}
    </>
  );
}

const locked = (add: DraftState) =>
  pendingWrite(add) !== null ||
  isChecking(add) ||
  Boolean(add.ai?.opening) ||
  Boolean(add.ai?.comparing);

/** Asks AI for suggestions for the checked term. */
export function SuggestButton({ add }: { add: DraftState }) {
  const { store, deps } = useDraftStore();
  if (!canSuggest(add)) return null;
  return <AiButton disabled={locked(add)} onClick={() => void store.generate(deps)} />;
}

/** Asks again after a failed generation. */
export function RetryButton({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store, deps } = useDraftStore();
  const failed = current(add) && (add.ai?.status === "failed" || add.ai?.status === "unauthorized");
  return failed ? (
    <button
      type="button"
      className={button.secondary}
      onClick={() => void store.retryGeneration(deps)}
    >
      {t("vocab.ai.retry")}
    </button>
  ) : null;
}

/** Records the open suggestion as skipped and moves on. */
export function SkipButton({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store, deps } = useDraftStore();
  if (!add.aiSource || pendingWrite(add)) return null;
  return (
    <button type="button" className={button.quiet} onClick={() => void store.skip(deps)}>
      {t("vocab.ai.skip")}
    </button>
  );
}

/** Previous and Next, while another suggestion is undecided. */
export function SuggestionNav({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store, deps } = useDraftStore();
  const { ai, aiSource } = add;
  const other =
    current(add) &&
    (ai?.suggestions.some((item) => item.key !== aiSource?.key && !item.saved && !item.skipped) ??
      false);
  if (!other) return null;
  return (
    <>
      <button
        type="button"
        className={iconButton}
        aria-label={t("vocab.ai.previous")}
        title={t("vocab.ai.previous")}
        disabled={locked(add)}
        onClick={() => void store.previousSuggestion(deps)}
      >
        <PreviousIcon />
      </button>
      <button
        type="button"
        className={iconButton}
        aria-label={t("vocab.ai.next")}
        title={t("vocab.ai.next")}
        disabled={locked(add)}
        onClick={() => void store.nextSuggestion(deps)}
      >
        <NextIcon />
      </button>
    </>
  );
}

/** Opens the suggestion under review in the form. */
export function EditSuggestionButton({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={t("vocab.ai.edit")}
      title={t("vocab.ai.edit")}
      disabled={locked(add)}
      onClick={store.editSuggestion}
    >
      <EditIcon />
    </button>
  );
}

/** The bar while AI works or existing meanings are shown, when AI has something to offer or report. */
export function AiBar({ add }: { add: DraftState }) {
  const busy =
    current(add) &&
    (add.ai?.status !== "ready" || add.ai.opening !== null || add.ai.comparing !== null);
  if (!canSuggest(add) && !add.aiSource && !busy && !add.ai?.openProblem) return null;
  return (
    <ActionBar
      add={add}
      start={
        <>
          <RetryButton add={add} />
          <SkipButton add={add} />
        </>
      }
      end={
        <>
          <SuggestionNav add={add} />
          <SuggestButton add={add} />
        </>
      }
    />
  );
}
