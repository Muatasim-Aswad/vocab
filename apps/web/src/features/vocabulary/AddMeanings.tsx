import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { BackIcon, EditIcon } from "../../shared/icons.tsx";
import {
  actions,
  button,
  iconButton,
  result,
  resultTerm,
  supporting,
  termPrefix,
} from "../../shared/ui.ts";
import { partOfSpeechLabel } from "./display-model.ts";
import { unlabeledMatches } from "./draft.ts";
import { FieldError, LookupProblem } from "./DraftForm.tsx";
import { entryEditPath } from "./entryPaths.ts";
import { EntryResult } from "./EntryResult.tsx";
import { freshMatch, type DraftState } from "./store.ts";
import type { EntrySummary, Prepared } from "./types.ts";
import { useDraftStore } from "./vocabulary-context.ts";
import { pendingWrite } from "./workflow/state.ts";

const existing = "grid gap-3";

/**
 * Entries listing the term among their forms: Proceed adds the term as its own word, Edit opens an
 * entry instead, and Cancel ends the add.
 */
export function FormOf({
  add,
  prepared,
  lastSearch,
}: {
  add: DraftState;
  prepared: Prepared;
  lastSearch: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { store } = useDraftStore();
  const busy = pendingWrite(add) !== null;
  const single = prepared.formOf.length === 1 ? prepared.formOf[0] : undefined;
  const edit = (id: number) => {
    void navigate(entryEditPath(id), { state: { capture: add.capture } });
    store.discard();
  };
  return (
    <section className={existing} aria-labelledby="add-form-of">
      <h2 id="add-form-of" tabIndex={-1} className="hyphens-auto">
        {t("vocab.add.formOfHeading", { term: prepared.term, count: prepared.formOf.length })}
      </h2>
      <ol>
        {prepared.formOf.map((entry) => (
          <EntryResult
            key={entry.id}
            item={entry}
            from="entry"
            action={
              single ? undefined : (
                <button
                  type="button"
                  className={iconButton}
                  aria-label={`${t("vocab.add.edit")} ${entry.lemma}${entry.senseCue ? ` ${entry.senseCue}` : ""}`}
                  title={t("vocab.add.edit")}
                  disabled={busy}
                  onClick={() => edit(entry.id)}
                >
                  <EditIcon />
                </button>
              )
            }
          />
        ))}
      </ol>
      <div className={actions}>
        <button type="button" className={button.primary} disabled={busy} onClick={store.keepTerm}>
          {t("vocab.add.proceed")}
        </button>
        {single ? (
          <button
            type="button"
            className={button.secondary}
            disabled={busy}
            onClick={() => edit(single.id)}
          >
            {t("vocab.add.edit")}
          </button>
        ) : null}
        <button
          type="button"
          className={button.quiet}
          disabled={busy}
          onClick={() => {
            store.discard();
            void navigate(`/${lastSearch}`);
          }}
        >
          {t("vocab.add.cancel")}
        </button>
      </div>
    </section>
  );
}

/**
 * The term's existing meanings: edit one of them, or label them to add another meaning. For an AI
 * suggestion, the choice is whether it is one of them or a new meaning.
 */
export function ExistingMeanings({
  add,
  prepared,
}: {
  add: DraftState;
  prepared: Prepared | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { store, deps } = useDraftStore();
  if (!prepared)
    return add.lookup.status === "failed" ? (
      <LookupProblem
        state={add}
        message={t("vocab.add.checkFailed")}
        onRetry={() => void store.prepare(deps)}
      />
    ) : add.lookup.status === "preparing" ? (
      <p className={supporting}>{t("vocab.add.checking")}</p>
    ) : null;
  if (!prepared.matches.length) return null;
  const { draft, errors } = add;
  const several = prepared.matches.length > 1;
  const choosing = !draft.addMeaning;
  const suggestion = add.aiSource !== null;
  const recommended = choosing && suggestion ? freshMatch(add, prepared) : undefined;
  const busy = pendingWrite(add) !== null;
  // Editing moves to the entry's Edit page, taking the reviewed capture along.
  const edit = (id: number) => {
    void navigate(entryEditPath(id), { state: { capture: add.capture } });
    store.discard();
  };
  const unlabeled = new Set(unlabeledMatches(prepared).map((match) => match.id));
  return (
    <section className={existing} aria-labelledby={choosing ? "add-meanings" : undefined}>
      {choosing ? (
        <h2 id="add-meanings" tabIndex={-1} className="hyphens-auto">
          {t("vocab.add.existingHeading", { term: prepared.term, count: prepared.matches.length })}
        </h2>
      ) : null}
      {/* While labeling, each unlabeled meaning takes its label beneath, and a rule closes the list. */}
      <ol className={choosing ? undefined : "[&>li:last-child]:border-b"}>
        {prepared.matches.map((match) => (
          <EntryResult
            key={match.id}
            item={match}
            from="entry"
            detail={
              !choosing && unlabeled.has(match.id) ? (
                <BackfillField add={add} entry={match} />
              ) : undefined
            }
            action={
              choosing && suggestion ? (
                <button
                  type="button"
                  className={
                    recommended?.decision === "same" && recommended.entryId === match.id
                      ? button.primary
                      : button.secondary
                  }
                  aria-label={
                    several
                      ? `${t("vocab.add.sameMeaning")} ${match.senseCue ?? match.lemma}`
                      : undefined
                  }
                  disabled={busy}
                  onClick={() => void store.sameMeaning(deps, match.id)}
                >
                  {t("vocab.add.sameMeaning")}
                </button>
              ) : choosing ? (
                <button
                  type="button"
                  className={iconButton}
                  aria-label={
                    several
                      ? `${t("vocab.add.editEntry")} ${match.senseCue ?? match.lemma}`
                      : t("vocab.add.editEntry")
                  }
                  title={t("vocab.add.editEntry")}
                  disabled={busy}
                  onClick={() => edit(match.id)}
                >
                  <EditIcon />
                </button>
              ) : undefined
            }
          />
        ))}
        {choosing && !suggestion ? null : <NewMeaning add={add} labeled={!choosing} />}
      </ol>
      <FieldError id="add-meanings" error={errors.meanings} />
      {draft.addMeaning ? (
        <MeaningsActions add={add} />
      ) : (
        <div className={actions}>
          <button
            type="button"
            className={recommended?.decision === "new" ? button.primary : button.secondary}
            disabled={busy}
            onClick={suggestion ? store.newMeaning : () => store.setAddMeaning(true)}
          >
            {t(suggestion ? "vocab.add.newMeaning" : "vocab.add.addAnotherMeaning")}
          </button>
        </div>
      )}
    </section>
  );
}

/** The label for an existing unlabeled meaning, beneath that meaning. */
function BackfillField({ add, entry }: { add: DraftState; entry: EntrySummary }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const { draft, errors } = add;
  return (
    <ResultLabel
      add={add}
      id={`add-backfill-${entry.id}`}
      label={t("vocab.add.existingLabel", {
        description: entry.extra ?? t("vocab.add.entryNumber", { id: entry.id }),
      })}
      value={draft.backfills[entry.id] ?? ""}
      error={errors[`backfill-${entry.id}`]}
      onChange={(value) => store.edit({ backfills: { ...draft.backfills, [entry.id]: value } })}
    />
  );
}

function ResultLabel({
  add,
  id,
  label,
  value,
  error,
  onChange,
}: {
  add: DraftState;
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 grid gap-1">
      <input
        id={id}
        data-no-submit=""
        aria-label={label}
        placeholder={t("vocab.add.entryLabelPlaceholder")}
        disabled={pendingWrite(add) !== null}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

/**
 * The meaning being added, as a card after the existing ones with its label beneath once it is
 * another meaning: the term alone for the user's own draft, or what an AI suggestion holds, whose
 * term may differ from the one typed.
 */
function NewMeaning({ add, labeled }: { add: DraftState; labeled: boolean }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const { draft } = add;
  const partOfSpeech = partOfSpeechLabel(t, draft.partOfSpeech);
  const example = draft.examples.map((item) => item.trim()).find(Boolean);
  return (
    <li className={result}>
      <p className={resultTerm} lang="nl" data-testid="term">
        {draft.article ? <span className={termPrefix}>{draft.article} </span> : null}
        {draft.term.trim()}
      </p>
      {partOfSpeech ? <p className={supporting}>{partOfSpeech}</p> : null}
      {example ? (
        <p className="mt-1 wrap-anywhere italic" lang="nl">
          {example}
        </p>
      ) : null}
      {labeled ? (
        <ResultLabel
          add={add}
          id="add-senseCue"
          label={t("vocab.add.newLabel")}
          value={draft.senseCue}
          error={add.errors.senseCue}
          onChange={(senseCue) => store.edit({ senseCue })}
        />
      ) : null}
    </li>
  );
}

/** Back to choosing among the existing meanings, or Continue to the fields. */
function MeaningsActions({ add }: { add: DraftState }) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  return (
    <div className={actions}>
      <button
        type="button"
        className={iconButton}
        aria-label={t("vocab.add.back")}
        title={t("vocab.add.back")}
        disabled={pendingWrite(add) !== null}
        onClick={() => store.setAddMeaning(false)}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className={button.primary}
        disabled={pendingWrite(add) !== null}
        onClick={store.confirmMeanings}
      >
        {t("vocab.add.continue")}
      </button>
    </div>
  );
}
