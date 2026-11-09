import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  cn,
  relationIcon,
  result,
  resultTerm,
  resultWithAction,
  senseCue,
  supporting,
  termPrefix,
} from "../../shared/ui.ts";
import { partOfSpeechLabel, relationRows } from "./display-model.ts";
import { Highlight } from "./display.tsx";
import type { SearchItem } from "./types.ts";

/** The first example containing the query, else the first example. */
function exampleFor(item: SearchItem, query: string): string | undefined {
  const needle = query.toLowerCase();
  return (
    item.examples?.find((example) => example.toLowerCase().includes(needle)) ?? item.examples?.[0]
  );
}

/** An entry as a result row, linking to its page; `action` sits beside it and `detail` beneath. */
export function EntryResult({
  item,
  query = "",
  from = "search",
  action,
  detail,
}: {
  item: SearchItem;
  query?: string;
  from?: "search" | "entry";
  action?: ReactNode;
  detail?: ReactNode;
}) {
  const { t } = useTranslation();
  const pos = partOfSpeechLabel(t, item.partOfSpeech);
  const example = exampleFor(item, query);
  return (
    <li className={cn(result, action && resultWithAction)}>
      <Link
        to={`/entries/${item.id}`}
        state={{ from }}
        className="group inline text-fg no-underline"
      >
        <span
          className={cn(
            resultTerm,
            "group-hover:underline group-hover:decoration-2 group-hover:underline-offset-[0.15em]",
          )}
          lang="nl"
          data-testid="term"
        >
          {item.article ? <span className={termPrefix}>{item.article} </span> : null}
          <Highlight text={item.lemma} query={query} />
        </span>
        {item.senseCue ? <span className={senseCue}> {item.senseCue}</span> : null}
      </Link>
      {pos ? <p className={supporting}>{pos}</p> : null}
      <RelatedWords item={item} from={from} />
      {example ? (
        <p className="mt-1 wrap-anywhere italic" lang="nl">
          <Highlight text={example} query={query} />
        </p>
      ) : null}
      {detail}
      {action ? <div className="col-start-2 row-[1/span_3]">{action}</div> : null}
    </li>
  );
}

const shownRelations = 3;

/** A stub's related words as links, by relation order, with the rest counted. */
function RelatedWords({ item, from }: { item: SearchItem; from: "search" | "entry" }) {
  const { t } = useTranslation();
  const order = relationRows.map(([type]) => type);
  const related = (item.relations ?? []).toSorted(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  );
  if (!related.length) return null;
  const hidden = related.length - shownRelations;
  const icons = new Map(relationRows);
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-supporting" lang="nl">
      {related.slice(0, shownRelations).map(({ type, entry }) => {
        const Icon = icons.get(type)!;
        const label = t(`vocab.relation.${type}`);
        return (
          <span key={`${type}-${entry.id}`} className="inline-flex items-center gap-1">
            <span className={relationIcon} title={label}>
              <Icon />
            </span>
            <span className="sr-only">{label}: </span>
            <Link
              to={`/entries/${entry.id}`}
              state={{ from }}
              className="text-fg no-underline hover:text-action"
            >
              {entry.article ? <span className={termPrefix}>{entry.article} </span> : null}
              {entry.lemma}
            </Link>
          </span>
        );
      })}
      {hidden > 0 ? (
        <span className={cn(supporting, "inline-flex items-center gap-1")}>+{hidden}</span>
      ) : null}
    </p>
  );
}
