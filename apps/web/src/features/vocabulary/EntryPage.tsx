import { ApiError } from "@vocab/api-client";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { formatDateTime, formatDecimal } from "../../shared/format.ts";
import { BackIcon, EditIcon, MoreHorizontalIcon } from "../../shared/icons.tsx";
import { Notice } from "../../shared/Notice.tsx";
import {
  backButton,
  button,
  cn,
  emptyState,
  entryClosing,
  entryNote,
  entryTag,
  entryTags,
  entryTerm,
  factRow,
  iconButton,
  pageBar,
  pageSections,
  senseCue,
  supporting,
} from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { Term } from "./display.tsx";
import { EntryBody, EntryLink } from "./EntryBody.tsx";
import { entryEditPath, parseEntryId } from "./entryPaths.ts";
import { describeError } from "./errors.ts";
import { useEntry } from "./queries.ts";
import type { Entry, EntryDetail } from "./types.ts";

export function EntryPage() {
  const { t } = useTranslation();
  const params = useParams();
  const id = parseEntryId(params.id);
  const entry = useEntry(id);
  const notFound =
    id === undefined || (entry.error instanceof ApiError && entry.error.code === "not_found");
  usePageTitle(entry.data ? entry.data.entry.lemma : t("vocab.entry.title"));

  // With other meanings, the cue shows as the current tab and stays in the heading only for screen readers.
  const heading = notFound ? (
    t("vocab.entry.notFoundHeading")
  ) : entry.data ? (
    <>
      <Term entry={entry.data.entry} separablePart={entry.data.separablePart} />
      {entry.data.entry.senseCue ? (
        <span className={entry.data.siblings.length ? "sr-only" : cn(senseCue, "text-lg")}>
          {" "}
          {entry.data.entry.senseCue}
        </span>
      ) : null}
    </>
  ) : (
    t("vocab.entry.title")
  );

  // One stable heading across loading, error and loaded states keeps route focus on it.
  return (
    <div className={pageSections}>
      <div className={pageBar}>
        <BackLink />
        {entry.data ? (
          <Link
            to={entryEditPath(entry.data.entry.id)}
            state={{ from: "entry" }}
            className={iconButton}
            aria-label={t("vocab.entry.edit")}
            title={t("vocab.entry.edit")}
          >
            <EditIcon />
          </Link>
        ) : null}
      </div>
      <h1
        tabIndex={-1}
        lang={entry.data ? "nl" : undefined}
        className={entry.data ? entryTerm : notFound ? undefined : "sr-only"}
      >
        {heading}
      </h1>
      {notFound ? (
        <div className={emptyState}>
          <p>{t("vocab.entry.notFound")}</p>
          <Link to="/">{t("vocab.entry.toSearch")}</Link>
        </div>
      ) : entry.data ? (
        <EntryView detail={entry.data} />
      ) : entry.isError ? (
        <Notice tone="error" role="alert">
          <p>
            {t("vocab.entry.failed")} {t(describeError(entry.error).key)}
          </p>
          <button type="button" className={button.secondary} onClick={() => void entry.refetch()}>
            {t("common.retry")}
          </button>
        </Notice>
      ) : (
        <p role="status" className={supporting}>
          {t("vocab.entry.loading")}
        </p>
      )}
    </div>
  );
}

/** Internal navigation returns through history (keeping search state); direct links go to Search. */
function BackLink() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState: unknown = location.state;
  const from =
    typeof routeState === "object" && routeState !== null && "from" in routeState
      ? routeState.from
      : undefined;
  if (from === "search" || from === "entry") {
    const label = from === "search" ? t("vocab.entry.backToSearch") : t("vocab.entry.back");
    return (
      <button
        type="button"
        className={backButton}
        aria-label={label}
        title={label}
        onClick={() => void navigate(-1)}
      >
        <BackIcon />
      </button>
    );
  }
  return (
    <Link
      to="/"
      className={backButton}
      aria-label={t("vocab.entry.toSearch")}
      title={t("vocab.entry.toSearch")}
    >
      <BackIcon />
    </Link>
  );
}

function EntryView({ detail }: { detail: EntryDetail }) {
  const { t } = useTranslation();
  const { entry, relations, siblings } = detail;
  const meanings = siblings.length
    ? [{ ...entry, current: true }, ...siblings].toSorted((a, b) => a.id - b.id)
    : [];

  return (
    <EntryBody
      entry={entry}
      relations={relations}
      meanings={
        meanings.length ? (
          <nav
            className="flex flex-wrap gap-x-4 gap-y-1 italic"
            aria-label={t("vocab.entry.meanings")}
          >
            {meanings.map((meaning) => {
              const cue = meaning.senseCue ?? t("vocab.add.noLabel");
              return "current" in meaning ? (
                <span
                  key={meaning.id}
                  aria-current="page"
                  className="border-b-2 border-current font-semibold"
                >
                  {cue}
                </span>
              ) : (
                <EntryLink key={meaning.id} entry={meaning}>
                  {cue}
                </EntryLink>
              );
            })}
          </nav>
        ) : null
      }
      closing={<EntryClosing entry={entry} />}
    />
  );
}

/** The note closes the entry; tags, dates and study data open from the ⋯ below it. */
function EntryClosing({ entry }: { entry: Entry }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const date = (value: string) => (
    <time dateTime={value}>
      {formatDateTime(new Date(value), i18n.language, { dateStyle: "long", timeStyle: "short" })}
    </time>
  );
  const rows: [string, ReactNode][] = [
    [t("vocab.entry.status"), t(`vocab.entry.statusValue.${entry.status ?? "active"}`)],
    [t("vocab.entry.added"), date(entry.meta.addedAt)],
    [t("vocab.entry.modified"), date(entry.meta.modifiedAt)],
    ...(entry.memory
      ? ([
          [t("vocab.entry.lastReviewed"), date(entry.memory.lastReviewed)],
          [
            t("vocab.entry.strength"),
            t("vocab.entry.strengthValue", { count: Math.round(entry.memory.strength) }),
          ],
          [
            t("vocab.entry.difficulty"),
            t("vocab.entry.difficultyValue", {
              value: formatDecimal(entry.memory.difficulty, i18n.language, 1),
            }),
          ],
          [t("vocab.entry.streak"), t("vocab.entry.streakValue", { count: entry.memory.streak })],
        ] satisfies [string, ReactNode][])
      : []),
    [t("vocab.entry.id"), entry.id],
    [t("vocab.entry.revision"), entry.revision],
  ];

  return (
    <footer className={entryClosing} lang={i18n.language}>
      {entry.extra ? (
        <p className={entryNote} lang="nl">
          {entry.extra}
        </p>
      ) : null}
      <button
        type="button"
        className={cn(iconButton, "-ml-3 text-supporting")}
        aria-label={t("vocab.entry.details")}
        title={t("vocab.entry.details")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontalIcon />
      </button>
      <div
        id={panelId}
        className="grid gap-3 justify-self-stretch rounded-md border border-boundary bg-surface px-4 py-3 text-sm text-supporting"
        hidden={!open}
      >
        {entry.tags?.length ? (
          <ul className={entryTags} aria-label={t("vocab.entry.tags")}>
            {entry.tags.map((tag) => (
              <li key={tag} className={entryTag}>
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid gap-1">
          {rows.map(([label, value]) => (
            <div key={label} className={factRow}>
              <dt>{label}</dt>
              <dd className="wrap-anywhere text-fg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </footer>
  );
}
