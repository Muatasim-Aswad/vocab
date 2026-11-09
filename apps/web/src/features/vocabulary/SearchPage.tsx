import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";

import { RemoveIcon } from "../../shared/icons.tsx";
import { Notice } from "../../shared/Notice.tsx";
import { finePointer } from "../../shared/pointer.ts";
import { useToast } from "../../shared/toast-context.ts";
import {
  actions,
  button,
  checkLabel,
  cn,
  control,
  fieldIconButton,
  loadMore,
  pageSections,
  statusLine,
  supporting,
} from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { AiButton } from "./AiButton.tsx";
import { CaptureRow, WriteNotice } from "./CaptureControls.tsx";
import { useCapturedTerm, useCapturesStartingWith, useCaptureTerm } from "./captures.ts";
import { EntryResult } from "./EntryResult.tsx";
import { describeError } from "./errors.ts";
import { distinctEntries, useSearchResults, type SearchParams } from "./queries.ts";
import { useRecentSearches } from "./recentSearches.ts";
import { SearchHome } from "./SearchHome.tsx";
import { TypeFilterField } from "./TypeFilterField.tsx";
import { typeFilterLabel } from "./typeFilters.ts";
import type { Capture } from "./types.ts";
import { useStartAdd } from "./useStartAdd.ts";
import { useVocabulary, useVocabularyStore } from "./vocabulary-context.ts";

const searchDelayMs = 250;

/** A text button whose chevron turns down while its panel is open. */
const disclosure = cn(
  control,
  "gap-2 px-0 text-action before:size-2 before:-rotate-45 before:border-r-2 before:border-b-2 before:border-current before:transition-transform before:duration-120 before:ease-[ease-out] aria-expanded:before:rotate-45",
);

function readParams(url: URLSearchParams): SearchParams {
  return {
    query: url.get("q")?.trim() ?? "",
    type: url.get("type")?.trim() ?? "",
    includeExamples: url.get("examples") === "1",
  };
}

function withParam(url: URLSearchParams, key: string, value: string | undefined) {
  const next = new URLSearchParams(url);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function SearchPage() {
  const { t } = useTranslation();
  usePageTitle(t("vocab.search.title"));
  const [url, setUrl] = useSearchParams();
  const params = readParams(url);
  const location = useLocation();
  const { store } = useVocabularyStore();
  const optionsOpen = useVocabulary((state) => state.searchOptionsOpen);
  const optionsId = useId();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const composing = useRef(false);

  // The input keeps what was typed; only an outside URL change (Back/Forward) replaces it.
  // `seen` is the URL's last query and `written` the last one this page set, so the check holds
  // whether local state or the URL update renders first.
  const [text, setText] = useState(params.query);
  const [seen, setSeen] = useState(params.query);
  const [written, setWritten] = useState(params.query);
  if (params.query !== seen) {
    setSeen(params.query);
    if (params.query !== written) {
      setWritten(params.query);
      setText(params.query);
    }
  }

  const recent = useRecentSearches();
  const clear = useRef<HTMLButtonElement>(null);

  useEffect(() => store.rememberSearch(location.search), [store, location.search]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function commitQuery(value: string) {
    window.clearTimeout(timer.current);
    const query = value.trim();
    setWritten(query);
    // Replacing keeps typing out of browser history; navigation to entries/Add adds history.
    setUrl((current) => withParam(current, "q", query), { replace: true });
  }

  function schedule(value: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commitQuery(value), searchDelayMs);
  }

  function setType(value: string) {
    setUrl((current) => withParam(current, "type", value), { replace: true });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current) return;
    commitQuery(text);
  }

  /** Empties the search after acting on a word nothing matched, also for returning from Add. */
  function clearSearch() {
    setText("");
    commitQuery("");
    const rest = withParam(url, "q", undefined).toString();
    store.rememberSearch(rest ? `?${rest}` : "");
    input.current?.focus();
  }

  function focusSearch() {
    if (finePointer()) input.current?.focus();
  }

  const results = useSearchResults(params);
  const capturedTerm = useCapturedTerm(params.query);
  const captured = capturedTerm.isError ? null : capturedTerm.data;
  const pages = results.data?.pages;
  const items = useMemo(() => distinctEntries(pages ?? []), [pages]);
  const shown = pages?.[0]?.params;
  const updating = results.isPlaceholderData;

  const activeOptions = [
    params.type &&
      t("vocab.search.activeType", {
        type: typeFilterLabel(t, params.type),
      }),
    params.includeExamples && t("vocab.search.activeExamples"),
  ].filter(Boolean);

  let status = "";
  if (params.query) {
    if (updating || (results.isFetching && !results.isFetchingNextPage))
      status = t("vocab.search.updating");
    else if (results.isSuccess)
      status = results.hasNextPage
        ? t("vocab.search.foundMore", { count: items.length })
        : t("vocab.search.found", { count: items.length });
  }

  return (
    <div className={pageSections}>
      <h1 tabIndex={-1} className="sr-only">
        {t("vocab.search.heading")}
      </h1>
      <form role="search" onSubmit={submit} className="grid gap-2">
        {/* Clear sits inside the field with its space always reserved, so typing never resizes the input. */}
        <div className="relative">
          <input
            ref={input}
            className="pe-12 text-lg [&::-webkit-search-cancel-button]:appearance-none"
            aria-label={t("vocab.search.label")}
            data-route-focus=""
            type="search"
            name="q"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={t("vocab.search.placeholder")}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (!composing.current) schedule(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter searches immediately, but never while an input method is composing.
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!composing.current && !event.nativeEvent.isComposing) commitQuery(text);
            }}
            onCompositionStart={() => {
              composing.current = true;
              window.clearTimeout(timer.current);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              schedule(event.currentTarget.value);
            }}
            onBlur={(event) => {
              // Leaving the field keeps the term; Clear and switching windows do not.
              if (composing.current || !document.hasFocus()) return;
              if (event.relatedTarget === clear.current) return;
              recent.record(event.currentTarget.value);
            }}
          />
          {text ? (
            <button
              ref={clear}
              type="button"
              className={cn(fieldIconButton, "text-supporting hover:text-fg")}
              aria-label={t("vocab.search.clear")}
              title={t("vocab.search.clear")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setText("");
                commitQuery("");
                input.current?.focus();
              }}
            >
              <RemoveIcon />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          <button
            type="button"
            className={disclosure}
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => store.setSearchOptionsOpen(!optionsOpen)}
          >
            {t("vocab.search.options")}
          </button>
          {activeOptions.length ? (
            <span className={supporting}>{activeOptions.join(", ")}</span>
          ) : null}
          <div id={optionsId} hidden={!optionsOpen} className="grid basis-full gap-3 py-2">
            <TypeFilterField value={params.type} onChange={setType} />
            <label className={checkLabel}>
              <input
                type="checkbox"
                checked={params.includeExamples}
                onChange={(event) =>
                  setUrl(
                    (current) =>
                      withParam(current, "examples", event.target.checked ? "1" : undefined),
                    { replace: true },
                  )
                }
              />
              {t("vocab.search.includeExamples")}
            </label>
          </div>
        </div>
      </form>

      <p role="status" className={statusLine}>
        {status}
      </p>

      {!params.query ? (
        <SearchHome
          terms={recent.terms}
          searchFor={(term) => `?${withParam(url, "q", term)}`}
          onPick={(term) => {
            recent.record(term);
            focusSearch();
          }}
        />
      ) : results.isError && !results.data ? (
        <SearchFailure error={results.error} onRetry={() => void results.refetch()} />
      ) : items.length === 0 && results.isSuccess && !updating ? (
        <ZeroResults query={params.query} captured={captured} onActed={clearSearch} />
      ) : items.length ? (
        <section aria-labelledby={`${optionsId}-results`} aria-busy={updating}>
          <h2 id={`${optionsId}-results`} className="sr-only">
            {t("vocab.search.resultsHeading")}
          </h2>
          {updating && shown ? (
            <p className={cn(supporting, "mb-2")}>
              {t("vocab.search.showingPrevious", { query: shown.query })}
            </p>
          ) : null}
          <ol className={updating ? "opacity-55" : undefined}>
            {captured && !updating ? (
              <CaptureRow
                capture={captured}
                onRemoved={(hadFocus) => hadFocus && input.current?.focus()}
              />
            ) : null}
            {items.map((item) => (
              <EntryResult key={item.id} item={item} query={shown?.query ?? params.query} />
            ))}
          </ol>
          {results.isFetchNextPageError ? (
            <LoadMoreFailure
              error={results.error}
              onRetry={() => void results.fetchNextPage()}
              onRestart={() => void results.refetch()}
            />
          ) : results.hasNextPage && !updating ? (
            <button
              type="button"
              className={loadMore}
              disabled={results.isFetchingNextPage}
              onClick={() => void results.fetchNextPage()}
            >
              {results.isFetchingNextPage
                ? t("vocab.search.loadingMore")
                : t("vocab.search.loadMore")}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * An exactly captured term shows its capture row. Any other word can be captured, added now, or
 * added with AI suggestions, with the captured terms that start with it below. Each of those
 * actions empties the search.
 */
function ZeroResults({
  query,
  captured,
  onActed,
}: {
  query: string;
  captured: Capture | null | undefined;
  onActed: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const startAdd = useStartAdd();
  const write = useCaptureTerm();
  // Focus returns to Capture for later after the capture row's Remove.
  const focusCapture = useRef(false);
  if (captured === undefined) return null;
  if (captured)
    return (
      <ol>
        <CaptureRow
          capture={captured}
          onRemoved={(hadFocus) => {
            if (!hadFocus) return;
            const capture = document.getElementById("search-capture");
            if (capture) capture.focus();
            else focusCapture.current = true;
          }}
        />
      </ol>
    );
  return (
    <div className="grid gap-4 pt-4">
      <div className={actions}>
        <button
          ref={(node) => {
            if (!node || !focusCapture.current) return;
            focusCapture.current = false;
            node.focus();
          }}
          id="search-capture"
          type="button"
          className={button.secondary}
          disabled={write.state.status === "saving"}
          onClick={async () => {
            if (!(await write.run(query))) return;
            toast(t("vocab.captures.captured", { term: query }));
            onActed();
          }}
        >
          {write.state.status === "saving"
            ? t("vocab.search.capturing")
            : t("vocab.search.captureForLater")}
        </button>
        <button
          type="button"
          className={button.secondary}
          onClick={() => {
            onActed();
            startAdd(query);
          }}
        >
          {t("vocab.search.addThisWord")}
        </button>
        <AiButton
          onClick={() => {
            onActed();
            startAdd(query, { withAi: true });
          }}
        />
      </div>
      <WriteNotice state={write.state} term={query} kind="capture" />
      <CapturesStartingWith prefix={query} />
    </div>
  );
}

function CapturesStartingWith({ prefix }: { prefix: string }) {
  const { t } = useTranslation();
  const id = useId();
  const list = useCapturesStartingWith(prefix);
  const pages = list.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  if (!items.length) return null;
  return (
    <section className="grid gap-1" aria-labelledby={id}>
      <h2 id={id} className="sr-only">
        {t("vocab.search.capturesStartingWith", { prefix })}
      </h2>
      <ol>
        {items.map((capture) => (
          <CaptureRow
            key={capture.id}
            capture={capture}
            highlight={prefix}
            onRemoved={(hadFocus) => {
              if (hadFocus) document.getElementById("search-capture")?.focus();
            }}
          />
        ))}
      </ol>
      {list.hasNextPage ? (
        <button
          type="button"
          className={loadMore}
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t("vocab.search.loadingMore") : t("vocab.search.loadMore")}
        </button>
      ) : null}
    </section>
  );
}

function SearchFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const problem = describeError(error);
  return (
    <Notice tone="error" role="alert">
      <p>
        {t("vocab.search.failed")} {t(problem.key)}
      </p>
      <button type="button" className={button.secondary} onClick={onRetry}>
        {t("common.retry")}
      </button>
    </Notice>
  );
}

function LoadMoreFailure({
  error,
  onRetry,
  onRestart,
}: {
  error: unknown;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const problem = describeError(error);
  const stale = problem.key === "vocab.error.staleCursor";
  return (
    <Notice tone="error" role="alert">
      <p>
        {t("vocab.search.loadMoreFailed")} {t(problem.key)}
      </p>
      <button type="button" className={button.secondary} onClick={stale ? onRestart : onRetry}>
        {stale ? t("vocab.search.restart") : t("common.retry")}
      </button>
    </Notice>
  );
}
