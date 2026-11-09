import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Notice } from "../../shared/Notice.tsx";
import {
  button,
  emptyState,
  loadMore,
  pageSections,
  statusLine,
  supporting,
} from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { CaptureRow, WriteNotice } from "./CaptureControls.tsx";
import { focusWasLost } from "./captureFocus.ts";
import { useCaptureList, useCaptureTerm } from "./captures.ts";
import { describeError } from "./errors.ts";

export function CapturesPage() {
  const { t } = useTranslation();
  usePageTitle(t("vocab.captures.title"));
  const list = useCaptureList();
  const pages = list.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);

  // Once a removed row is gone, the row now at its position (or the last row, or the list) takes
  // the focus it had.
  const removed = useRef<{ id: string; index: number } | null>(null);
  const refocus = useCallback(() => {
    const target = removed.current;
    if (!target || document.getElementById(`capture-${target.id}-add`)) return;
    removed.current = null;
    if (!focusWasLost()) return;
    const buttons = document.querySelectorAll<HTMLElement>("[id^='capture-'][id$='-add']");
    (
      buttons[Math.min(target.index, buttons.length - 1)] ??
      document.getElementById("captures-list")
    )?.focus();
  }, []);
  useEffect(refocus, [items, refocus]);

  return (
    <div className={pageSections}>
      <h1 tabIndex={-1}>{t("vocab.captures.heading")}</h1>
      <CaptureForm />
      <section aria-labelledby="captures-list" aria-busy={list.isFetching}>
        <h2 id="captures-list" tabIndex={-1} className="sr-only">
          {t("vocab.captures.listHeading")}
        </h2>
        {list.isPending ? (
          <p role="status" className={supporting}>
            {t("vocab.captures.loading")}
          </p>
        ) : list.isError && !list.data ? (
          <ListFailure error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <p className={emptyState}>{t("vocab.captures.empty")}</p>
        ) : (
          <ol>
            {items.map((capture, index) => (
              <CaptureRow
                key={capture.id}
                capture={capture}
                onRemoved={() => {
                  removed.current = { id: capture.id, index };
                  refocus();
                }}
              />
            ))}
          </ol>
        )}
        {list.isFetchNextPageError ? (
          <ListFailure
            error={list.error}
            more
            onRetry={() => void list.fetchNextPage()}
            onRestart={() => void list.refetch()}
          />
        ) : list.hasNextPage ? (
          <button
            type="button"
            className={loadMore}
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage
              ? t("vocab.captures.loadingMore")
              : t("vocab.captures.loadMore")}
          </button>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The field keeps focus through a capture, so terms can be entered one after another. A retry of
 * an unconfirmed capture reuses its identity while the term is unchanged.
 */
function CaptureForm() {
  const { t } = useTranslation();
  const write = useCaptureTerm();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState("");
  const saving = write.state.status === "saving";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !text.trim()) return;
    setDone("");
    const saved = await write.run(text);
    if (!saved) return;
    setText("");
    setDone(t("vocab.captures.captured", { term: saved.term }));
    const active = document.activeElement;
    if (focusWasLost() || (active && form.current?.contains(active))) input.current?.focus();
  }

  return (
    <form ref={form} className="grid gap-2" onSubmit={(event) => void submit(event)}>
      <div className="flex gap-2">
        <input
          ref={input}
          aria-label={t("vocab.captures.inputLabel")}
          placeholder={t("vocab.captures.placeholder")}
          data-route-focus=""
          className="min-w-0 flex-auto text-lg"
          lang="nl"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          value={text}
          readOnly={saving}
          onChange={(event) => {
            setText(event.target.value);
            setDone("");
            write.reset();
          }}
        />
        <button type="submit" className={button.primary} disabled={saving}>
          {saving ? t("vocab.captures.capturing") : t("vocab.captures.capture")}
        </button>
      </div>
      <p role="status" className={statusLine}>
        {done}
      </p>
      <WriteNotice state={write.state} term={text.trim()} kind="capture" />
    </form>
  );
}

function ListFailure({
  error,
  more = false,
  onRetry,
  onRestart,
}: {
  error: unknown;
  more?: boolean;
  onRetry: () => void;
  onRestart?: () => void;
}) {
  const { t } = useTranslation();
  const problem = describeError(error);
  const stale = problem.key === "vocab.error.staleCursor" && onRestart;
  return (
    <Notice tone="error" role="alert">
      <p>
        {t(more ? "vocab.captures.loadMoreFailed" : "vocab.captures.failed")} {t(problem.key)}
      </p>
      <button type="button" className={button.secondary} onClick={stale ? onRestart : onRetry}>
        {stale ? t("vocab.captures.restart") : t("common.retry")}
      </button>
    </Notice>
  );
}
