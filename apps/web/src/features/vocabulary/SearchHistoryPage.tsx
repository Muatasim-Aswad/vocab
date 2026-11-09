import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Notice } from "../../shared/Notice.tsx";
import {
  button,
  chipLink,
  chipList,
  emptyState,
  listControls,
  pageSections,
  supporting,
} from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { useRecentSearches } from "./recentSearches.ts";

const searchPath = (term: string) => `/?${new URLSearchParams({ q: term })}`;

export function SearchHistoryPage() {
  const { t } = useTranslation();
  usePageTitle(t("vocab.history.title"));
  const recent = useRecentSearches();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <div className={pageSections}>
      <h1 ref={heading} tabIndex={-1}>
        {t("vocab.history.heading")}
      </h1>
      {recent.loading ? (
        <p role="status" className={supporting}>
          {t("vocab.history.loading")}
        </p>
      ) : recent.failed ? (
        <Notice tone="error" role="alert">
          <p>{t("vocab.history.failed")}</p>
          <button type="button" className={button.secondary} onClick={recent.retry}>
            {t("common.retry")}
          </button>
        </Notice>
      ) : recent.terms.length === 0 ? (
        <p className={emptyState}>{t("vocab.history.empty")}</p>
      ) : (
        <div>
          <div className={listControls}>
            <button
              type="button"
              className={button.secondary}
              onClick={() => {
                recent.clear();
                heading.current?.focus();
              }}
            >
              {t("vocab.history.clear")}
            </button>
          </div>
          <ul className={chipList}>
            {recent.terms.map((term) => (
              <li key={term}>
                <Link
                  to={searchPath(term)}
                  className={chipLink}
                  lang="nl"
                  onClick={() => recent.record(term)}
                >
                  {term}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
