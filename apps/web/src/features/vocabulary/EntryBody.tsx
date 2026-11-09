import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { cn, relationIcon, senseCue, supporting, termPrefix } from "../../shared/ui.ts";
import { partOfSpeechLabel, relationRows } from "./display-model.ts";
import type { Entry, EntrySummary, RelationType } from "./types.ts";

export type EntryContent = Pick<
  Entry,
  "lemma" | "partOfSpeech" | "constructionType" | "grammar" | "forms" | "examples" | "collocations"
>;

/** A related word; one without an ID is not saved yet and shows as plain text. */
export interface RelatedWord {
  type: RelationType;
  entry: Pick<EntrySummary, "lemma" | "article" | "senseCue" | "partOfSpeech"> & { id?: number };
}

const knownGrammar = new Set([
  "article",
  "isReflexive",
  "isSeparable",
  "isCountable",
  "isDiminutive",
  "number",
  "irregular",
]);

export function EntryLink({ entry, children }: { entry: { id: number }; children: ReactNode }) {
  return (
    <Link to={`/entries/${entry.id}`} state={{ from: "entry" }}>
      {children}
    </Link>
  );
}

/** Keeps the whole phrase readable while the headword steps back, so its partner words stand out. */
function Collocation({ text, lemma }: { text: string; lemma: string }) {
  const words = lemma
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text;
  const pattern = new RegExp(`(?<!\\p{L})(${words.join("|")})(?!\\p{L})`, "giu");
  return text.split(pattern).map((part, index) =>
    index % 2 ? (
      <span key={index} className="font-normal text-supporting">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** An entry's content in reading order: kind and forms, examples, collocations, relations, closing. */
export function EntryBody({
  entry,
  relations,
  meanings,
  closing,
}: {
  entry: EntryContent;
  relations: RelatedWord[];
  meanings?: ReactNode;
  closing: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const kind = [
    partOfSpeechLabel(t, entry.partOfSpeech),
    entry.constructionType && t(`vocab.construction.${entry.constructionType}`),
    ...grammarNotes(t, entry),
  ].filter(Boolean);

  return (
    <article className="grid gap-6" lang="nl">
      <header className="grid gap-2">
        {meanings}
        {kind.length || entry.forms?.length ? (
          <p className={supporting} lang={i18n.language}>
            {kind.length ? (
              <>
                <span className="font-semibold">{kind[0]}</span>
                {kind.slice(1).map((note) => `, ${note}`)}
              </>
            ) : null}
            {kind.length && entry.forms?.length ? <span aria-hidden="true"> · </span> : null}
            {entry.forms?.length ? <span lang="nl">{entry.forms.join(", ")}</span> : null}
          </p>
        ) : null}
      </header>

      {entry.examples?.length ? (
        <ul className="grid gap-2 text-lg">
          {entry.examples.map((example, index) => (
            <li
              key={index}
              className="relative max-w-reading pl-[1.1rem] italic before:absolute before:left-[0.15rem] before:text-supporting before:not-italic before:content-['›']"
            >
              {example}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.collocations?.length ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 font-semibold">
          {entry.collocations.map((collocation, index) => (
            <li key={index}>
              <Collocation text={collocation} lemma={entry.lemma} />
            </li>
          ))}
        </ul>
      ) : null}
      {relations.length ? (
        <div className="grid gap-1">
          {relationRows.map(([type, Icon]) => {
            const group = relations.filter((relation) => relation.type === type);
            const label = t(`vocab.relation.${type}`);
            return group.length ? (
              <p key={type} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-2">
                <span className={cn(relationIcon, "h-[1.5em]")} title={label}>
                  <Icon />
                </span>
                <span className="flex min-w-0 flex-wrap gap-x-3">
                  <span className="sr-only" lang={i18n.language}>
                    {label}:
                  </span>
                  {group.map(({ entry: target }, index) => {
                    const word = (
                      <>
                        {target.lemma}
                        {target.senseCue ? (
                          <span className={senseCue}> {target.senseCue}</span>
                        ) : null}
                      </>
                    );
                    return (
                      <span key={target.id ?? `new-${index}`}>
                        {target.article ? (
                          <span className={cn(termPrefix, "text-[0.9em]")}>{target.article} </span>
                        ) : null}
                        {target.id === undefined ? (
                          word
                        ) : (
                          <EntryLink entry={{ id: target.id }}>{word}</EntryLink>
                        )}
                        {type === "posVariation" && target.partOfSpeech ? (
                          <span className="text-sm text-supporting italic" lang={i18n.language}>
                            {" "}
                            {partOfSpeechLabel(t, target.partOfSpeech)}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              </p>
            ) : null;
          })}
        </div>
      ) : null}

      {closing}
    </article>
  );
}

/** Grammar in plain words; the article is already before the headword. */
function grammarNotes(t: (key: string) => string, entry: EntryContent): string[] {
  const grammar = entry.grammar ?? {};
  const notes: string[] = [];
  if (typeof grammar.isCountable === "boolean")
    notes.push(grammar.isCountable ? t("vocab.grammar.countable") : t("vocab.grammar.uncountable"));
  if (typeof grammar.number === "string")
    notes.push(t(`vocab.grammar.numberValue.${grammar.number}`));
  for (const flag of ["isReflexive", "isSeparable", "irregular", "isDiminutive"] as const)
    if (grammar[flag] === true) notes.push(t(`vocab.grammar.${flag}`));
  // Unrecognized stored grammar is shown as stored rather than hidden.
  for (const [key, value] of Object.entries(grammar))
    if (!knownGrammar.has(key) && value !== undefined)
      notes.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return notes;
}
