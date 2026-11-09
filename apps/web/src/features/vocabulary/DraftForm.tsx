import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddIcon } from "../../shared/icons.tsx";
import { Notice } from "../../shared/Notice.tsx";
import { button, cn, control, fieldError, fieldStack, supporting } from "../../shared/ui.ts";
import { DetailFields } from "./DetailFields.tsx";
import { editShowsLabel, editTarget } from "./draft.ts";
import { InfoTip } from "./InfoTip.tsx";
import { ListField } from "./ListField.tsx";
import { PreviousNote } from "./PreviousNote.tsx";
import type { DraftState } from "./store.ts";
import type { Prepared } from "./types.ts";
import { useDraft, useDraftStore } from "./vocabulary-context.ts";
import { isChecking, pendingWrite, saveNotice } from "./workflow/state.ts";

/** Save, which becomes Retry while a submission is unresolved. */
export function SaveButton({ state, label }: { state: DraftState; label: string }) {
  const { t } = useTranslation();
  const saving = pendingWrite(state)?.status === "saving" || isChecking(state);
  const unresolved = pendingWrite(state) !== null && !saving;
  return (
    <>
      <button
        type="submit"
        className={button.primary}
        disabled={saving}
        aria-describedby="add-saving"
      >
        {saving ? t("vocab.add.saving") : unresolved ? t("vocab.add.retry") : label}
      </button>
      <span id="add-saving" role="status" className="sr-only">
        {saving ? t("vocab.add.saving") : ""}
      </span>
    </>
  );
}

export function FieldError({ id, error }: { id: string; error: string | undefined }) {
  const { t } = useTranslation();
  return error ? (
    <p id={`${id}-error`} className={fieldError}>
      {t(error)}
    </p>
  ) : null;
}

/** The meaning label field of the entry being added or edited, when it has or needs one. */
function MeaningLabel({ state, prepared }: { state: DraftState; prepared: Prepared }) {
  const { t } = useTranslation();
  const target = editTarget(state.draft, prepared);
  if (target)
    return editShowsLabel(prepared, target) ? (
      <LabelField label={t("vocab.add.completeLabel")} error={state.errors.senseCue} />
    ) : null;
  if (state.draft.addMeaning)
    return <LabelField label={t("vocab.add.newLabel")} error={state.errors.senseCue} />;
  return state.aiSource && !prepared.matches.length ? (
    <LabelField label={t("vocab.add.completeLabel")} error={state.errors.senseCue} />
  ) : null;
}

/** Notes, behind an Add notes button unless the draft has some. */
function NotesField() {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const extra = useDraft((state) => state.draft.extra);
  const replaced = useDraft((state) => state.draft.previous.extra !== undefined);
  const [open, setOpen] = useState(() => Boolean(extra.trim()));
  return open ? (
    <div className={fieldStack}>
      <div className="flex flex-wrap items-center">
        <label htmlFor="add-extra">{t("vocab.add.notes")}</label>
        <InfoTip id="add-extra-help" text={t("vocab.add.notesHelp")} />
      </div>
      <textarea
        id="add-extra"
        rows={3}
        value={extra}
        aria-describedby={replaced ? "add-extra-help add-extra-previous" : "add-extra-help"}
        onChange={(event) => store.edit({ extra: event.target.value })}
      />
      <PreviousNote field="extra" id="add-extra-previous" />
    </div>
  ) : (
    <button
      type="button"
      className={cn(
        control,
        "gap-2 justify-self-start px-0 font-medium text-action [&_svg]:size-5",
      )}
      onClick={() => {
        setOpen(true);
        requestAnimationFrame(() => document.getElementById("add-extra")?.focus());
      }}
    >
      <AddIcon />
      {t("vocab.add.addNotes")}
    </button>
  );
}

export function DraftFields({ state, prepared }: { state: DraftState; prepared: Prepared }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const locked = pendingWrite(state) !== null;
  const { draft } = state;

  return (
    <>
      <fieldset disabled={locked} className="grid gap-6">
        <MeaningLabel state={state} prepared={prepared} />
        <ListField
          id="add-examples"
          label={t("vocab.add.examples")}
          help={t("vocab.add.examplesHelp")}
          itemLabel={(position) => t("vocab.add.exampleItem", { position })}
          addLabel={t("vocab.add.addExample")}
          values={draft.examples}
          lang="nl"
          onChange={(examples) => store.edit({ examples })}
        />
      </fieldset>
      <DetailFields state={state} locked={locked} notes={<NotesField />} />
    </>
  );
}

/** Why checking the term or opening the entry failed, with Retry. */
export function LookupProblem({
  state,
  message,
  onRetry,
}: {
  state: DraftState;
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const problem = state.lookup.status === "failed" ? state.lookup.problem : null;
  if (!problem) return null;
  return (
    <Notice tone="error" role="alert">
      <p>
        {message} {t(problem.key)}
      </p>
      <button type="button" className={button.secondary} onClick={onRetry}>
        {t("common.retry")}
      </button>
    </Notice>
  );
}

function LabelField({ label, error }: { label: string; error: string | undefined }) {
  const { store } = useDraftStore();
  const senseCue = useDraft((state) => state.draft.senseCue);
  const replaced = useDraft((state) => state.draft.previous.senseCue !== undefined);
  const locked = useDraft((state) => pendingWrite(state) !== null);
  const describedBy = [error && "add-senseCue-error", replaced && "add-senseCue-previous"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={fieldStack}>
      <label htmlFor="add-senseCue">{label}</label>
      <input
        id="add-senseCue"
        data-no-submit=""
        value={senseCue}
        disabled={locked}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => store.edit({ senseCue: event.target.value })}
      />
      <PreviousNote field="senseCue" id="add-senseCue-previous" />
      <FieldError id="add-senseCue" error={error} />
    </div>
  );
}

export function SaveNotice({ state }: { state: DraftState }) {
  const { t } = useTranslation();
  const notice = saveNotice(state);
  const pending = pendingWrite(state);
  if (!notice) return null;
  const term = pending?.term ?? state.draft.term.trim();
  const message =
    notice.kind === "uncertain"
      ? t("vocab.add.uncertain", { term })
      : notice.kind === "unauthorized"
        ? t("vocab.add.unauthorized", { term })
        : notice.kind === "exists"
          ? t("vocab.add.exists", { term })
          : notice.kind === "reviewRelations"
            ? t("vocab.add.reviewRelations")
            : notice.kind === "notSent"
              ? `${t(notice.key ?? "vocab.error.unexpected")} ${t("vocab.add.notSaved")}`
              : t(notice.key ?? "vocab.error.unexpected");
  return (
    <Notice id="add-notice" tabIndex={-1} tone="error" role="alert">
      <p>{message}</p>
      {notice.kind === "uncertain" && notice.key ? (
        <p className={supporting}>{t(notice.key)}</p>
      ) : null}
      {notice.requestId ? (
        <details>
          <summary>{t("common.requestReferenceLabel")}</summary>
          <code>{notice.requestId}</code>
        </details>
      ) : null}
    </Notice>
  );
}
