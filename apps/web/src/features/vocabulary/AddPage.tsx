import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { AddIcon, ClearIcon, KeepIcon, SuggestIcon } from "../../shared/icons.tsx";
import { Notice } from "../../shared/Notice.tsx";
import { actions, button, cn, fieldStack, iconButton, pageSections } from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { ExistingMeanings, FormOf } from "./AddMeanings.tsx";
import {
  ActionBar,
  AiBar,
  EditSuggestionButton,
  RetryButton,
  SkipButton,
  SuggestButton,
  SuggestionNav,
} from "./AiControls.tsx";
import { aiBusy, hasUndecided, reviewing } from "./aiDisplayState.ts";
import { useCapturedTerm } from "./captures.ts";
import { currentPreparation, formDecisionPending } from "./draft.ts";
import { DraftFields, FieldError, SaveButton, SaveNotice } from "./DraftForm.tsx";
import { isCaptureLink } from "./entryPaths.ts";
import { keepEnterInRows, useDraftFocus } from "./formBehavior.ts";
import { type CaptureLink, type DraftState } from "./store.ts";
import { SuggestionPreview } from "./SuggestionPreview.tsx";
import type { Prepared } from "./types.ts";
import { useDraft, useDraftStore, useVocabulary } from "./vocabulary-context.ts";
import { DraftScope } from "./VocabularyProvider.tsx";
import { pendingWrite } from "./workflow/state.ts";

/**
 * Add runs in stages: the term alone, then, when other entries list it among their forms, whether
 * to add it anyway, then a choice among its existing meanings, then the fields. The fields replace
 * the choice once the term is new or the labels for another meaning were given; editing an
 * existing meaning moves to its Edit page. AI, asked for with the term or from the form, shows each
 * suggestion as an entry to accept, skip or open in the form; when its term has meanings the user
 * has not seen, the user first says whether it is one of them. The actions sit in a pinned header.
 * A save returns to Search unless another suggestion is undecided, and so does skipping the last
 * one.
 */
function showsFields(add: DraftState, prepared: Prepared | undefined): boolean {
  if (!add.termConfirmed || !prepared || formDecisionPending(add.draft, prepared)) return false;
  const { addMeaning, meaningsConfirmed, editId } = add.draft;
  return !prepared.matches.length || editId !== null || (addMeaning && meaningsConfirmed);
}

/** The open suggestion's term has meanings the user has not identified it with or set it beside. */
const decidingSuggestion = (add: DraftState, prepared: Prepared | undefined) =>
  add.aiSource !== null &&
  Boolean(prepared?.matches.length) &&
  !add.draft.addMeaning &&
  add.draft.editId === null;

const termAction = cn(iconButton, "h-auto rounded-md text-action hover:bg-transparent");

export function AddPage() {
  return (
    <DraftScope kind="add">
      <AddForm />
    </DraftScope>
  );
}

function AddForm() {
  const { t } = useTranslation();
  usePageTitle(t("vocab.add.title"));
  const add = useDraft((state) => state);
  const lastSearch = useVocabulary((state) => state.lastSearch);
  const { store, deps } = useDraftStore();
  const navigate = useNavigate();
  const [earlier] = useState(() => store.getState());
  const done =
    (add.saved !== null && add.saved !== earlier.saved && !hasUndecided(add)) ||
    (add.aiFinished !== null && add.aiFinished !== earlier.aiFinished);
  const term = add.draft.term.trim();
  const captured = useCapturedTerm(add.termConfirmed ? term : "").data;
  const prepared = currentPreparation(add.draft, add.preparation);
  const fields = showsFields(add, prepared);
  const busy = aiBusy(add);
  const labeling = add.termConfirmed && add.draft.addMeaning && !fields && prepared !== undefined;
  const review = reviewing(add) && prepared !== undefined && !decidingSuggestion(add, prepared);
  const formPending = prepared !== undefined && formDecisionPending(add.draft, prepared);
  const wantsAi =
    add.aiRequested &&
    prepared !== undefined &&
    !formPending &&
    (!prepared.matches.length || add.draft.addMeaning);

  useDraftFocus(add.focus);

  const shownSuggestion = add.aiSource?.key;
  useEffect(() => {
    if (shownSuggestion) void store.present(deps, shownSuggestion);
  }, [shownSuggestion, store, deps]);

  useEffect(() => {
    if (add.termConfirmed && term.trim()) void store.prepare(deps);
  }, [add.termConfirmed, term, store, deps]);

  useEffect(() => {
    if (wantsAi) void store.generate(deps);
  }, [wantsAi, store, deps]);

  useEffect(() => {
    if (captured && !add.capture) store.linkCapture(captured);
  }, [captured, add.capture, store]);

  useEffect(() => {
    if (done) void navigate(`/${lastSearch}`, { replace: true });
  }, [done, navigate, lastSearch]);

  return (
    <div className={pageSections}>
      <h1 tabIndex={-1} className="sr-only">
        {t("vocab.add.heading")}
      </h1>
      <form
        noValidate
        className="grid gap-6"
        onKeyDown={keepEnterInRows}
        onSubmit={(event) => {
          event.preventDefault();
          if (!add.termConfirmed) store.confirmTerm();
          else if (fields || review) void store.save(deps);
        }}
      >
        {review ? (
          <ReviewActions add={add} />
        ) : fields && !busy ? (
          <Actions add={add} lastSearch={lastSearch} />
        ) : (
          <AiBar add={add} />
        )}
        <ProposedTerm />
        {review ? (
          <SuggestionPreview add={add} />
        ) : (
          <>
            {labeling ? null : <TermField add={add} />}
            {busy ? null : (
              <>
                {fields ? (
                  <>
                    <DraftFields
                      key={add.aiSource?.key ?? "own"}
                      state={add}
                      prepared={prepared!}
                    />
                    <SaveNotice state={add} />
                  </>
                ) : add.termConfirmed ? (
                  <>
                    {formPending ? (
                      <FormOf add={add} prepared={prepared} lastSearch={lastSearch} />
                    ) : (
                      <ExistingMeanings add={add} prepared={prepared} />
                    )}
                    <SaveNotice state={add} />
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </form>
    </div>
  );
}

/** The term, with Continue and AI icons until it is submitted; changing it starts over. */
function TermField({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const { draft, errors } = add;
  return (
    <div className={fieldStack}>
      {/* Continue and AI sit inside the field like Search's Clear, with their space always reserved. */}
      <div className="relative">
        <input
          id="add-term"
          aria-label={t("vocab.add.term")}
          placeholder={t("vocab.add.placeholder")}
          data-route-focus=""
          className="pe-[5.75rem] text-term-input font-semibold"
          lang="nl"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint={add.termConfirmed ? "done" : "next"}
          disabled={pendingWrite(add) !== null}
          value={draft.term}
          onChange={(event) => store.edit({ term: event.target.value })}
          {...(errors.term && { "aria-invalid": true, "aria-describedby": "add-term-error" })}
        />
        {!add.termConfirmed && draft.term.trim() ? (
          <span className="absolute inset-y-0 end-0 flex">
            <button
              type="submit"
              className={termAction}
              aria-label={t("vocab.add.continue")}
              title={t("vocab.add.continue")}
            >
              <AddIcon />
            </button>
            <button
              type="button"
              className={termAction}
              aria-label={t("vocab.ai.suggest")}
              title={t("vocab.ai.suggest")}
              onClick={store.askAi}
            >
              <SuggestIcon />
            </button>
          </span>
        ) : null}
      </div>
      <FieldError id="add-term" error={errors.term} />
    </div>
  );
}

/**
 * Save and Cancel, then Clear, Keep draft and AI as icons. While the form holds an AI suggestion,
 * only Skip and moving between suggestions remain beside Save.
 */
function Actions({ add, lastSearch }: { add: DraftState; lastSearch: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { store } = useDraftStore();
  const back = `/${lastSearch}`;
  const save = <SaveButton state={add} label={t("vocab.add.save")} />;
  if (add.aiSource)
    return (
      <ActionBar
        add={add}
        start={
          <>
            {save}
            <SkipButton add={add} />
          </>
        }
        end={<SuggestionNav add={add} />}
      />
    );
  return (
    <ActionBar
      add={add}
      start={
        <>
          {save}
          {pendingWrite(add) ? null : (
            <button
              type="button"
              className={button.quiet}
              onClick={() => {
                store.discard();
                void navigate(back);
              }}
            >
              {t("vocab.add.cancel")}
            </button>
          )}
          <RetryButton add={add} />
        </>
      }
      end={
        <>
          {pendingWrite(add) ? null : (
            <button
              type="button"
              className={iconButton}
              aria-label={t("vocab.add.clear")}
              title={t("vocab.add.clear")}
              onClick={store.discard}
            >
              <ClearIcon />
            </button>
          )}
          <Link
            to={back}
            className={iconButton}
            aria-label={t("vocab.add.keepForLater")}
            title={t("vocab.add.keepForLater")}
          >
            <KeepIcon />
          </Link>
          <SuggestButton add={add} />
        </>
      }
    />
  );
}

/** Accept saves the suggestion as shown; Edit opens it in the form. */
function ReviewActions({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  return (
    <ActionBar
      add={add}
      start={
        <>
          <SaveButton state={add} label={t("vocab.ai.accept")} />
          <SkipButton add={add} />
        </>
      }
      end={
        <>
          <SuggestionNav add={add} />
          <EditSuggestionButton add={add} />
        </>
      }
    />
  );
}

interface ProposedState {
  proposedTerm?: string;
  proposedCapture?: CaptureLink;
  proposedAi?: boolean;
}

function isProposedState(value: unknown): value is ProposedState {
  if (typeof value !== "object" || value === null) return false;
  return (
    (!("proposedTerm" in value) ||
      value.proposedTerm === undefined ||
      typeof value.proposedTerm === "string") &&
    (!("proposedCapture" in value) ||
      value.proposedCapture === undefined ||
      isCaptureLink(value.proposedCapture)) &&
    (!("proposedAi" in value) ||
      value.proposedAi === undefined ||
      typeof value.proposedAi === "boolean")
  );
}

/** Search's "Add this word" never silently replaces a different unsaved draft. */
function ProposedTerm() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { store } = useDraftStore();
  const draftTerm = useDraft((state) => state.draft.term);
  const routeState: unknown = location.state;
  const {
    proposedTerm: proposed,
    proposedCapture,
    proposedAi,
  } = isProposedState(routeState) ? routeState : {};
  if (!proposed) return null;
  const dismiss = () => void navigate(".", { replace: true, state: null });
  return (
    <Notice role="group" aria-labelledby="add-proposal">
      <p id="add-proposal">
        {t("vocab.add.proposal", { draft: draftTerm.trim() || "…", term: proposed })}
      </p>
      <div className={actions}>
        <button type="button" className={button.secondary} onClick={dismiss}>
          {t("vocab.add.keepDraft")}
        </button>
        <button
          type="button"
          className={button.secondary}
          onClick={() => {
            store.startWithTerm(proposed, proposedCapture, proposedAi);
            dismiss();
          }}
        >
          {t("vocab.add.replaceDraft", { term: proposed })}
        </button>
      </div>
    </Notice>
  );
}
