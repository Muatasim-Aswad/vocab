import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { formatDateTime } from "../../shared/format.ts";
import { AddIcon, RemoveIcon } from "../../shared/icons.tsx";
import { Notice } from "../../shared/Notice.tsx";
import {
  actions,
  cn,
  iconButton,
  result,
  resultTerm,
  resultWithAction,
  supporting,
} from "../../shared/ui.ts";
import { AiButton } from "./AiButton.tsx";
import { focusWasLost } from "./captureFocus.ts";
import { useRemoveCapture, type WriteState } from "./captures.ts";
import { Highlight } from "./display.tsx";
import type { Capture } from "./types.ts";
import { useStartAdd } from "./useStartAdd.ts";

/** Why a capture write failed; an unconfirmed one can be retried without repeating it. */
export function WriteNotice({
  state,
  term,
  kind,
  className,
}: {
  state: WriteState;
  term: string;
  kind: "capture" | "remove";
  className?: string;
}) {
  const { t } = useTranslation();
  if (state.status !== "failed") return null;
  const outcome = state.unauthorized ? "Unauthorized" : state.uncertain ? "Uncertain" : "Rejected";
  return (
    <Notice tone="error" role="alert" className={className}>
      <p>{t(`vocab.captures.${kind}${outcome}`, { term })}</p>
      {state.unauthorized ? null : <p className={supporting}>{t(state.problem.key)}</p>}
      {state.problem.requestId ? (
        <details>
          <summary>{t("common.requestReferenceLabel")}</summary>
          <code>{state.problem.requestId}</code>
        </details>
      ) : null}
    </Notice>
  );
}

const capturedAt = (value: string, locale: string) =>
  formatDateTime(new Date(value), locale, { dateStyle: "medium" });

function CapturedDate({ capture }: { capture: Capture }) {
  const { t, i18n } = useTranslation();
  return (
    <p className={supporting}>
      {t("vocab.captures.capturedOn", { date: capturedAt(capture.createdAt, i18n.language) })}
    </p>
  );
}

/**
 * AI opens Add asking for suggestions, and Add entry opens Add for the term; saving it there
 * removes the capture in the same write.
 * `onRemoved` learns whether focus was on these actions, so the caller can move it.
 */
function CaptureActions({
  capture,
  idPrefix,
  onRemoved,
}: {
  capture: Capture;
  idPrefix: string;
  onRemoved: (hadFocus: boolean) => void;
}) {
  const { t } = useTranslation();
  const startAdd = useStartAdd();
  const removal = useRemoveCapture();
  const removing = removal.state.status === "saving";
  const root = useRef<HTMLDivElement>(null);
  const addLabel = t("vocab.captures.addEntry");
  const removeLabel = removing ? t("vocab.captures.removing") : t("vocab.captures.remove");
  return (
    <>
      <div ref={root} className={cn(actions, "col-start-2 row-[1/span_2] flex-nowrap gap-1")}>
        <AiButton
          term={capture.term}
          onClick={() =>
            startAdd(capture.term, {
              capture: { id: capture.id, term: capture.term },
              withAi: true,
            })
          }
        />
        <button
          id={`${idPrefix}-add`}
          type="button"
          className={iconButton}
          aria-label={`${addLabel} ${capture.term}`}
          title={addLabel}
          onClick={() =>
            startAdd(capture.term, { capture: { id: capture.id, term: capture.term } })
          }
        >
          <AddIcon />
        </button>
        <button
          type="button"
          className={cn(iconButton, "hover:text-error")}
          aria-label={`${removeLabel} ${capture.term}`}
          title={removeLabel}
          disabled={removing}
          onClick={async () => {
            if (!(await removal.run(capture))) return;
            onRemoved(focusWasLost() || Boolean(root.current?.contains(document.activeElement)));
          }}
        >
          <RemoveIcon />
        </button>
      </div>
      <WriteNotice
        state={removal.state}
        term={capture.term}
        kind="remove"
        className="col-span-full mt-2"
      />
    </>
  );
}

/** A captured term in a list, with its actions; `highlight` marks where it matches. */
export function CaptureRow({
  capture,
  highlight = "",
  onRemoved,
}: {
  capture: Capture;
  highlight?: string;
  onRemoved: (hadFocus: boolean) => void;
}) {
  return (
    <li className={cn(result, resultWithAction, "[&>:not(div)]:col-start-1")}>
      <span className={resultTerm} lang="nl" data-testid="term">
        <Highlight text={capture.term} query={highlight} />
      </span>
      <CapturedDate capture={capture} />
      <CaptureActions capture={capture} idPrefix={`capture-${capture.id}`} onRemoved={onRemoved} />
    </li>
  );
}
