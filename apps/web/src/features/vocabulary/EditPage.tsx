import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Notice } from "../../shared/Notice.tsx";
import { actions, button, pageSections, supporting } from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { ActionBar } from "./AiControls.tsx";
import { currentPreparation } from "./draft.ts";
import { DraftFields, LookupProblem, SaveButton, SaveNotice } from "./DraftForm.tsx";
import { isCaptureLink } from "./entryPaths.ts";
import { entryEditPath, entryPath, parseEntryId } from "./entryPaths.ts";
import { keepEnterInRows, useDraftFocus } from "./formBehavior.ts";
import type { CaptureLink, DraftState } from "./store.ts";
import { useDraft, useDraftStore, useVocabulary } from "./vocabulary-context.ts";
import { DraftScope } from "./VocabularyProvider.tsx";
import { pendingWrite } from "./workflow/state.ts";

/** How Edit was reached: from the entry page (returned to through history), or with a capture from Add. */
interface EditLocationState {
  from?: "entry";
  capture?: CaptureLink | null;
}

function isEditLocationState(value: unknown): value is EditLocationState {
  if (typeof value !== "object" || value === null) return false;
  return (
    (!("from" in value) || value.from === undefined || value.from === "entry") &&
    (!("capture" in value) || value.capture == null || isCaptureLink(value.capture))
  );
}

export function EditPage() {
  return (
    <DraftScope kind="edit">
      <EditForm />
    </DraftScope>
  );
}

/** Unsaved changes or an unresolved save of another entry keep that entry's draft. */
const holdsOtherEntry = (edit: DraftState, id: number | undefined) =>
  edit.draft.editId !== null &&
  edit.draft.editId !== id &&
  (pendingWrite(edit) !== null || edit.changed);

function EditForm() {
  const { t } = useTranslation();
  const id = parseEntryId(useParams().id);
  const location = useLocation();
  const navigate = useNavigate();
  const edit = useDraft((state) => state);
  const { store, deps } = useDraftStore();
  const lastSearch = useVocabulary((state) => state.lastSearch);
  const routeState: unknown = location.state;
  const { from, capture = null } = isEditLocationState(routeState) ? routeState : {};
  const [earlierSave] = useState(() => store.getState().saved);
  const leaving = useRef(false);
  const saved = edit.saved !== null && edit.saved !== earlierSave;
  const other = holdsOtherEntry(edit, id);
  const term = edit.draft.editId === id ? edit.draft.term : "";
  usePageTitle(term ? t("vocab.edit.title", { term }) : t("vocab.edit.titleLoading"));
  useDraftFocus(edit.focus);

  const leave = () => {
    leaving.current = true;
    if (from === "entry") void navigate(-1);
    else if (id !== undefined) void navigate(entryPath(id), { replace: true });
  };

  // Each visit reads the entry again, unless its draft holds changes or is still opening.
  useEffect(() => {
    if (id === undefined || leaving.current) return;
    const current = store.getState();
    if (current.saved !== null && current.saved !== earlierSave) return;
    if (holdsOtherEntry(current, id)) return;
    const open = current.changed || pendingWrite(current) !== null || current.loadingEdit;
    if (current.draft.editId === id && open) return;
    void store.openEdit(deps, id, capture);
  }, [id, store, deps, capture, earlierSave]);

  useEffect(() => {
    if (!saved || leaving.current) return;
    leaving.current = true;
    void navigate(`/${lastSearch}`, { replace: true });
  });

  if (id === undefined)
    return (
      <div className={pageSections}>
        <h1 tabIndex={-1}>{t("vocab.entry.notFoundHeading")}</h1>
        <p>{t("vocab.entry.notFound")}</p>
      </div>
    );

  const prepared = currentPreparation(edit.draft, edit.preparation);
  const ready = edit.draft.editId === id && !edit.loadingEdit && prepared !== undefined;

  return (
    <div className={pageSections}>
      <h1 tabIndex={-1}>
        {term ? (
          <>
            {t("vocab.edit.headingPrefix")} <span lang="nl">{term}</span>
          </>
        ) : (
          t("vocab.edit.titleLoading")
        )}
      </h1>
      {other ? (
        <Notice role="group" aria-labelledby="edit-other">
          <p id="edit-other">{t("vocab.edit.otherOpen", { term: edit.draft.term })}</p>
          <div className={actions}>
            <Link to={entryEditPath(edit.draft.editId!)} replace className={button.secondary}>
              {t("vocab.edit.keepOther", { term: edit.draft.term })}
            </Link>
            {pendingWrite(edit) ? null : (
              <button
                type="button"
                className={button.secondary}
                onClick={() => void store.openEdit(deps, id, capture)}
              >
                {t("vocab.edit.discardOther")}
              </button>
            )}
          </div>
        </Notice>
      ) : (
        <LookupProblem
          state={edit}
          message={t("vocab.add.editFailed")}
          onRetry={() => void store.openEdit(deps, id, capture)}
        />
      )}
      {ready ? (
        <form
          noValidate
          className="grid gap-6"
          onKeyDown={keepEnterInRows}
          onSubmit={(event) => {
            event.preventDefault();
            void store.save(deps);
          }}
        >
          <ActionBar
            add={edit}
            start={
              <>
                <SaveButton state={edit} label={t("vocab.add.save")} />
                <button
                  type="button"
                  className={button.quiet}
                  onClick={() => {
                    store.discard();
                    leave();
                  }}
                >
                  {t("vocab.add.cancel")}
                </button>
              </>
            }
          />
          <DraftFields state={edit} prepared={prepared} />
          <SaveNotice state={edit} />
        </form>
      ) : edit.loadingEdit ? (
        <p role="status" className={supporting}>
          {t("vocab.edit.loading")}
        </p>
      ) : null}
    </div>
  );
}
