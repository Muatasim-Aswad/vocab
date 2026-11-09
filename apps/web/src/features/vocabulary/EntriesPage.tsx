import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { Notice } from "../../shared/Notice.tsx";
import {
  button,
  emptyState,
  fieldStack,
  listControls,
  loadMore,
  pageSections,
  statusLine,
  supporting,
} from "../../shared/ui.ts";
import { usePageTitle } from "../../shared/usePageTitle.ts";
import { EntryResult } from "./EntryResult.tsx";
import { describeError } from "./errors.ts";
import { distinctEntries, useEntryList, type EntryOrder, type ListParams } from "./queries.ts";
import { TypeFilterField } from "./TypeFilterField.tsx";

const orders = ["added", "modified", "alphabetical"] as const satisfies readonly EntryOrder[];

function readParams(url: URLSearchParams): ListParams {
  const order = url.get("order");
  return {
    order: orders.find((item) => item === order) ?? "added",
    type: url.get("type")?.trim() ?? "",
  };
}

/** Every active entry as result cards, ordered and filtered through the URL. */
export function EntriesPage() {
  const { t } = useTranslation();
  usePageTitle(t("vocab.entries.title"));
  const [url, setUrl] = useSearchParams();
  const params = readParams(url);
  const list = useEntryList(params);
  const pages = list.data?.pages;
  const items = useMemo(() => distinctEntries(pages ?? []), [pages]);
  const total = pages?.[0]?.total ?? 0;
  const updating = list.isPlaceholderData;

  const set = (key: keyof ListParams, value: string) =>
    setUrl(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <div className={pageSections}>
      <h1 tabIndex={-1}>{t("vocab.entries.heading")}</h1>
      <div className={listControls}>
        <div className={fieldStack}>
          <select
            aria-label={t("vocab.entries.order")}
            value={params.order}
            onChange={(event) => set("order", event.target.value)}
          >
            {orders.map((order) => (
              <option key={order} value={order}>
                {t(`vocab.entries.orders.${order}`)}
              </option>
            ))}
          </select>
        </div>
        <TypeFilterField value={params.type} onChange={(type) => set("type", type)} />
      </div>
      <p role="status" className={statusLine}>
        {list.isSuccess && !updating ? t("vocab.entries.count", { count: total }) : ""}
      </p>
      {list.isPending ? (
        <p className={supporting}>{t("vocab.entries.loading")}</p>
      ) : list.isError && !list.data ? (
        <ListFailure error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <p className={emptyState}>
          {params.type ? t("vocab.entries.noMatch") : t("vocab.entries.empty")}
        </p>
      ) : (
        <ol className={updating ? "opacity-55" : undefined} aria-busy={updating}>
          {items.map((item) => (
            <EntryResult key={item.id} item={item} from="entry" />
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
      ) : list.hasNextPage && !updating ? (
        <button
          type="button"
          className={loadMore}
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t("vocab.search.loadingMore") : t("vocab.search.loadMore")}
        </button>
      ) : null}
    </div>
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
        {t(more ? "vocab.search.loadMoreFailed" : "vocab.entries.failed")} {t(problem.key)}
      </p>
      <button type="button" className={button.secondary} onClick={stale ? onRestart : onRetry}>
        {stale ? t("vocab.search.restart") : t("common.retry")}
      </button>
    </Notice>
  );
}
