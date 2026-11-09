import { useTranslation } from "react-i18next";

import {
  cn,
  entryClosing,
  entryNote,
  entryTag,
  entryTags,
  entryTerm,
  senseCue as senseCueStyle,
} from "../../shared/ui.ts";
import { Term } from "./display.tsx";
import { savedEntryFields } from "./draft.ts";
import { SaveNotice } from "./DraftForm.tsx";
import { EntryBody, type RelatedWord } from "./EntryBody.tsx";
import type { DraftState } from "./store.ts";

/** An AI suggestion shown as the entry Accept would save. */
export function SuggestionPreview({ add }: { add: DraftState }) {
  const { i18n } = useTranslation();
  const { draft } = add;
  const entry = savedEntryFields(draft, add.preparation);
  const senseCue = draft.senseCue.trim();
  const relations: RelatedWord[] = draft.relations
    .filter((relation) => relation.term.trim())
    .map((relation) => ({
      type: relation.type,
      entry:
        relation.lookup.status === "resolved"
          ? relation.lookup.target
          : { lemma: relation.term.trim() },
    }));

  return (
    <section aria-labelledby="add-suggestion">
      <h2 id="add-suggestion" tabIndex={-1} lang="nl" className={entryTerm}>
        <Term entry={{ ...entry, isMultiWord: /\s/.test(entry.lemma) }} />
        {senseCue ? <span className={cn(senseCueStyle, "text-lg")}> {senseCue}</span> : null}
      </h2>
      <SaveNotice state={add} />
      <EntryBody
        entry={entry}
        relations={relations}
        closing={
          entry.extra || entry.tags?.length ? (
            <footer className={entryClosing} lang={i18n.language}>
              {entry.extra ? (
                <p className={entryNote} lang="nl">
                  {entry.extra}
                </p>
              ) : null}
              {entry.tags?.length ? (
                <ul className={entryTags}>
                  {entry.tags.map((tag) => (
                    <li key={tag} className={entryTag}>
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
            </footer>
          ) : null
        }
      />
    </section>
  );
}
