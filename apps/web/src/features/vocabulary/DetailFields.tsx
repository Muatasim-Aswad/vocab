import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { checkLabel, inlineField, supporting } from "../../shared/ui.ts";
import { ChipField } from "./ChipField.tsx";
import {
  currentPreparation,
  effectiveDraft,
  shownSuggestedForms,
  suggestedFields,
  suggestedForms,
  type InferableField,
  type PreviousField,
} from "./draft.ts";
import { PreviousNote } from "./PreviousNote.tsx";
import { RelationsField } from "./RelationsField.tsx";
import type { DraftState } from "./store.ts";
import { constructionTypes, partsOfSpeech } from "./types.ts";
import { useDraftStore } from "./vocabulary-context.ts";

const grammarGroup = "grid gap-3 border-l-2 border-boundary pl-4";

/** Word type, forms, collocations, relationships and tags, then `notes`, then grammar. */
export function DetailFields({
  state,
  locked,
  notes,
}: {
  state: DraftState;
  locked: boolean;
  notes: ReactNode;
}) {
  const { t } = useTranslation();
  const { store } = useDraftStore();
  const id = useId();
  const values = effectiveDraft(state.draft, state.preparation);
  const suggested = new Set(suggestedFields(state.draft, state.preparation));
  const prepared = currentPreparation(state.draft, state.preparation);
  const multiWord = prepared?.inferred.isMultiWord === true;
  const pos = values.partOfSpeech;
  const showNoun = pos === "NOUN" || (!pos && values.article !== "");
  const shownForms = shownSuggestedForms(state.draft, state.preparation);
  const formsWaiting =
    !shownForms.length && suggestedForms(state.draft, state.preparation).length > 0;
  const hint = (field: InferableField) =>
    suggested.has(field) ? <span className={supporting}> {t("vocab.add.suggested")}</span> : null;
  const noteId = (field: PreviousField) =>
    state.draft.previous[field] === undefined ? undefined : `${id}-${field}-previous`;
  const note = (field: PreviousField) => <PreviousNote field={field} id={noteId(field)} />;

  return (
    <fieldset disabled={locked} className="grid gap-6">
      <div className={inlineField}>
        <label htmlFor="add-partOfSpeech">
          {t("vocab.add.partOfSpeech")}
          {hint("partOfSpeech")}
        </label>
        <select
          id="add-partOfSpeech"
          value={pos}
          aria-describedby={noteId("partOfSpeech")}
          onChange={(event) => store.edit({ partOfSpeech: event.target.value }, "partOfSpeech")}
        >
          <option value="">{t("vocab.add.notSet")}</option>
          {partsOfSpeech.map((value) => (
            <option key={value} value={value}>
              {t(`vocab.pos.${value}`)}
            </option>
          ))}
          {pos && !(partsOfSpeech as readonly string[]).includes(pos) ? (
            <option value={pos}>{pos}</option>
          ) : null}
        </select>
        {note("partOfSpeech")}
      </div>

      {multiWord ? (
        <div className={inlineField}>
          <label htmlFor={`${id}-construction`}>{t("vocab.add.constructionType")}</label>
          <select
            id={`${id}-construction`}
            value={values.constructionType}
            aria-describedby={noteId("constructionType")}
            onChange={(event) => {
              const value = event.target.value;
              const constructionType =
                value === "" ? "" : constructionTypes.find((item) => item === value);
              if (constructionType !== undefined) store.edit({ constructionType });
            }}
          >
            <option value="">{t("vocab.add.notSet")}</option>
            {constructionTypes.map((value) => (
              <option key={value} value={value}>
                {t(`vocab.construction.${value}`)}
              </option>
            ))}
          </select>
          {note("constructionType")}
        </div>
      ) : (
        <ChipField
          id="add-forms"
          label={t("vocab.add.forms")}
          help={t("vocab.add.formsHelp")}
          addLabel={t("vocab.add.addForm")}
          values={values.forms}
          suggestion={{
            values: shownForms,
            onDismiss: (form) =>
              store.edit({ dismissedForms: [...state.draft.dismissedForms, form] }),
            ...(formsWaiting && { onShow: () => store.edit({ showSuggestedForms: true }) }),
            showLabel: t("vocab.add.showSuggestedForms"),
          }}
          lang="nl"
          note={note("forms")}
          onChange={(forms) => store.edit({ forms }, "forms")}
        />
      )}

      <ChipField
        id="add-collocations"
        label={t("vocab.add.collocations")}
        addLabel={t("vocab.add.addCollocation")}
        values={values.collocations}
        lang="nl"
        onChange={(collocations) => store.edit({ collocations })}
      />
      <RelationsField relations={state.draft.relations} errors={state.errors} />
      <ChipField
        id="add-tags"
        label={t("vocab.add.tags")}
        help={t("vocab.add.tagsHelp")}
        addLabel={t("vocab.add.addTag")}
        values={values.tags}
        suggested={suggested.has("tags")}
        onChange={(tags) => store.edit({ tags }, "tags")}
      />
      {notes}
      {showNoun ? (
        <fieldset className={grammarGroup}>
          <legend>{t("vocab.add.nounGrammar")}</legend>
          <div className={inlineField}>
            <span className="font-semibold" id={`${id}-article`}>
              {t("vocab.grammar.article")}
              {hint("article")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-article`}
              aria-describedby={noteId("article")}
              className="flex flex-wrap gap-x-4"
            >
              {(["de", "het", ""] as const).map((article) => (
                <label key={article || "none"} className={checkLabel}>
                  <input
                    type="radio"
                    name={`${id}-article`}
                    checked={values.article === article}
                    onChange={() => store.edit({ article }, "article")}
                  />
                  {article ? <span lang="nl">{article}</span> : t("vocab.add.notSet")}
                </label>
              ))}
            </div>
            {note("article")}
          </div>
          <div className={inlineField}>
            <label htmlFor={`${id}-countable`}>{t("vocab.grammar.countability")}</label>
            <select
              id={`${id}-countable`}
              value={values.isCountable}
              aria-describedby={noteId("isCountable")}
              onChange={(event) => {
                const isCountable = event.target.value;
                if (isCountable === "" || isCountable === "yes" || isCountable === "no")
                  store.edit({ isCountable });
              }}
            >
              <option value="">{t("vocab.add.notSet")}</option>
              <option value="yes">{t("vocab.grammar.countable")}</option>
              <option value="no">{t("vocab.grammar.uncountable")}</option>
            </select>
            {note("isCountable")}
          </div>
          <div className={inlineField}>
            <label htmlFor={`${id}-number`}>{t("vocab.grammar.number")}</label>
            <select
              id={`${id}-number`}
              value={values.number}
              aria-describedby={noteId("number")}
              onChange={(event) => {
                const number = event.target.value;
                if (
                  number === "" ||
                  number === "singular" ||
                  number === "plural" ||
                  number === "both"
                )
                  store.edit({ number });
              }}
            >
              <option value="">{t("vocab.add.notSet")}</option>
              {(["singular", "plural", "both"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`vocab.grammar.numberValue.${value}`)}
                </option>
              ))}
            </select>
            {note("number")}
          </div>
          <label className={checkLabel}>
            <input
              type="checkbox"
              checked={values.isDiminutive}
              onChange={(event) => store.edit({ isDiminutive: event.target.checked })}
            />
            {t("vocab.grammar.isDiminutive")}
          </label>
        </fieldset>
      ) : null}

      {pos === "VERB" || pos === "ADJ" ? (
        <fieldset className={grammarGroup}>
          <legend>
            {pos === "VERB" ? t("vocab.add.verbGrammar") : t("vocab.add.adjectiveGrammar")}
          </legend>
          {(pos === "VERB"
            ? (["isReflexive", "isSeparable", "irregular"] as const)
            : (["irregular"] as const)
          ).map((flag) => (
            <label key={flag} className={checkLabel}>
              <input
                type="checkbox"
                checked={values[flag]}
                onChange={(event) => store.edit({ [flag]: event.target.checked }, flag)}
              />
              {t(`vocab.grammar.${flag}`)}
              {hint(flag)}
            </label>
          ))}
        </fieldset>
      ) : null}
    </fieldset>
  );
}
