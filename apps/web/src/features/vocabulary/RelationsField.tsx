import { useTranslation } from "react-i18next";

import { AddIcon, RemoveIcon, SearchIcon } from "../../shared/icons.tsx";
import {
  addRowButton,
  checkLabel,
  cn,
  fieldError,
  fieldIconButton,
  iconButton,
  listField,
  listLegend,
  removeButton,
  supporting,
} from "../../shared/ui.ts";
import type { RelationDraft } from "./draft.ts";
import { InfoTip } from "./InfoTip.tsx";
import { relationTypes, type EntrySummary } from "./types.ts";
import { useDraftStore } from "./vocabulary-context.ts";

let nextKey = 0;
const newRelation = (): RelationDraft => ({
  key: `r${++nextKey}`,
  type: "related",
  term: "",
  lookup: { status: "idle" },
});

const meaningName = (entry: EntrySummary) =>
  entry.senseCue ? `${entry.lemma} (${entry.senseCue})` : entry.lemma;

/** Relation, word, and Remove icon, with the word's lookup status beneath. */
const relationRow =
  "grid w-full grid-cols-[9rem_minmax(0,1fr)_44px] items-center gap-x-2 gap-y-1 border-boundary py-1 [&+&]:border-t";

/** Related terms resolve to explicit targets; unknown terms become visible pending stubs. */
export function RelationsField({
  relations,
  errors,
}: {
  relations: RelationDraft[];
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const { store, deps } = useDraftStore();
  const error = errors.relations;

  return (
    <fieldset
      className={listField}
      id="add-relations"
      tabIndex={-1}
      aria-labelledby="add-relations-label"
    >
      <legend className={listLegend}>
        <span id="add-relations-label">{t("vocab.add.relations")}</span>
        <InfoTip id="add-relations-help" text={t("vocab.add.relationsHelp")} />
        <button
          type="button"
          className={addRowButton}
          aria-label={t("vocab.add.addRelation")}
          title={t("vocab.add.addRelation")}
          onClick={() => store.edit({ relations: [...relations, newRelation()] })}
        >
          <AddIcon />
        </button>
      </legend>
      {error ? (
        <p className={fieldError} id="add-relations-error">
          {t(error)}
        </p>
      ) : null}
      {relations.length ? (
        <ol className="grid w-full gap-2">
          {relations.map((relation, index) => {
            const rowError = errors[`relation-${relation.key}`];
            const base = `add-relation-${relation.key}`;
            const { lookup } = relation;
            return (
              <li key={relation.key} className={relationRow}>
                <select
                  className="w-full"
                  id={`${base}-type`}
                  aria-label={t("vocab.add.relationType", { position: index + 1 })}
                  value={relation.type}
                  onChange={(event) => {
                    const type = relationTypes.find((item) => item === event.target.value);
                    if (type) store.editRelation(relation.key, { type });
                  }}
                >
                  {relationTypes.map((type) => (
                    <option key={type} value={type}>
                      {t(`vocab.relation.${type}`)}
                    </option>
                  ))}
                </select>
                <div className="relative min-w-0">
                  <input
                    className="pe-12"
                    id={base}
                    aria-label={t("vocab.add.relationTerm", { position: index + 1 })}
                    lang="nl"
                    data-no-submit=""
                    value={relation.term}
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={`${base}-status`}
                    onChange={(event) =>
                      store.editRelation(relation.key, { term: event.target.value })
                    }
                    onBlur={() => {
                      if (relation.lookup.status === "idle")
                        void store.lookupRelation(deps, relation.key);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing)
                        void store.lookupRelation(deps, relation.key);
                    }}
                  />
                  <button
                    type="button"
                    className={fieldIconButton}
                    aria-label={t("vocab.add.find")}
                    title={t("vocab.add.find")}
                    disabled={!relation.term.trim() || lookup.status === "loading"}
                    onClick={() => void store.lookupRelation(deps, relation.key)}
                  >
                    <SearchIcon />
                  </button>
                </div>
                <div
                  id={`${base}-status`}
                  className="col-span-full empty:hidden"
                  aria-live="polite"
                >
                  {lookup.status === "loading" ? (
                    <p className={supporting}>{t("vocab.add.lookingUp")}</p>
                  ) : lookup.status === "new" ? (
                    <p>
                      <span
                        className="inline-block cursor-help rounded-full border border-dashed border-action px-2 text-xs text-action"
                        title={t("vocab.add.pendingStub", { term: lookup.term })}
                      >
                        {t("vocab.add.newWord")}
                      </span>
                      <span className="sr-only">
                        {t("vocab.add.pendingStub", { term: lookup.term })}
                      </span>
                    </p>
                  ) : lookup.status === "failed" ? (
                    <p className={supporting}>{t("vocab.add.lookupFailed")}</p>
                  ) : null}
                  {(lookup.status === "choose" ||
                    (lookup.status === "resolved" && lookup.candidates.length > 1)) && (
                    <fieldset className="grid">
                      <legend>{t("vocab.add.chooseMeaning", { term: lookup.term })}</legend>
                      {lookup.candidates.map((candidate) => (
                        <label key={candidate.id} className={checkLabel}>
                          <input
                            type="radio"
                            name={`${base}-target`}
                            checked={
                              lookup.status === "resolved" && lookup.target.id === candidate.id
                            }
                            onChange={() => store.chooseRelationTarget(relation.key, candidate.id)}
                          />
                          <span lang="nl">{meaningName(candidate)}</span>
                          {candidate.extra ? (
                            <span className={supporting}> {candidate.extra}</span>
                          ) : null}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {rowError ? <p className={fieldError}>{t(rowError)}</p> : null}
                </div>
                <button
                  type="button"
                  className={cn(iconButton, removeButton, "col-start-3 row-start-1")}
                  aria-label={`${t("vocab.add.remove")} ${t("vocab.add.relationTerm", { position: index + 1 })}`}
                  title={t("vocab.add.remove")}
                  onClick={() =>
                    store.edit({
                      relations: relations.filter((item) => item.key !== relation.key),
                    })
                  }
                >
                  <RemoveIcon />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </fieldset>
  );
}
