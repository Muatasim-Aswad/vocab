import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { chipLink, chipList, senseCue, smallQuiet, termPrefix } from "../../shared/ui.ts";
import { useCaptureList } from "./captures.ts";
import { useRecentEntries } from "./queries.ts";

const shownSearches = 5;
const shownCaptures = 5;

/** What empty Search shows: recent searches, then recently changed entries, then the newest captures. */
export function SearchHome({
  terms,
  searchFor,
  onPick,
}: {
  terms: string[];
  searchFor: (term: string) => string;
  onPick: (term: string) => void;
}) {
  return (
    <>
      <RecentSearches terms={terms} searchFor={searchFor} onPick={onPick} />
      <RecentEntries />
      <RecentCaptures searchFor={searchFor} />
    </>
  );
}

function ChipSection({
  heading,
  action,
  children,
}: {
  heading: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="grid gap-2 pt-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold tracking-label text-supporting">
          {heading}
        </h2>
        {action}
      </div>
      <ul className={chipList}>{children}</ul>
    </section>
  );
}

function RecentSearches({
  terms,
  searchFor,
  onPick,
}: {
  terms: string[];
  searchFor: (term: string) => string;
  onPick: (term: string) => void;
}) {
  const { t } = useTranslation();
  if (!terms.length) return null;
  return (
    <ChipSection
      heading={t("vocab.search.recentHeading")}
      action={
        <Link to="/search-history" className={smallQuiet}>
          {t("vocab.search.allSearches")}
        </Link>
      }
    >
      {terms.slice(0, shownSearches).map((term) => (
        <li key={term}>
          <Link
            to={{ search: searchFor(term) }}
            className={chipLink}
            lang="nl"
            onClick={() => onPick(term)}
          >
            {term}
          </Link>
        </li>
      ))}
    </ChipSection>
  );
}

function RecentEntries() {
  const { t } = useTranslation();
  const entries = useRecentEntries().data;
  if (!entries?.length) return null;
  return (
    <ChipSection
      heading={t("vocab.search.recentEntriesHeading")}
      action={
        <Link to="/entries?order=modified" className={smallQuiet}>
          {t("vocab.search.allEntries")}
        </Link>
      }
    >
      {entries.map((entry) => (
        <li key={entry.id}>
          <Link
            to={`/entries/${entry.id}`}
            state={{ from: "search" }}
            className={chipLink}
            lang="nl"
          >
            <span>
              {entry.article ? <span className={termPrefix}>{entry.article} </span> : null}
              {entry.lemma}
              {entry.senseCue ? <span className={senseCue}> {entry.senseCue}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ChipSection>
  );
}

/** A captured term opens its search, where it can be added or removed. */
function RecentCaptures({ searchFor }: { searchFor: (term: string) => string }) {
  const { t } = useTranslation();
  const captures = useCaptureList().data?.pages[0]?.items.slice(0, shownCaptures);
  if (!captures?.length) return null;
  return (
    <ChipSection
      heading={t("vocab.search.recentCapturesHeading")}
      action={
        <Link to="/captures" className={smallQuiet}>
          {t("vocab.search.allCaptures")}
        </Link>
      }
    >
      {captures.map((capture) => (
        <li key={capture.id}>
          <Link to={{ search: searchFor(capture.term) }} className={chipLink} lang="nl">
            {capture.term}
          </Link>
        </li>
      ))}
    </ChipSection>
  );
}
