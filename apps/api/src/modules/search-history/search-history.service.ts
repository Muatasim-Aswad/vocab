import { Injectable } from "@nestjs/common";

import { AppError } from "../../shared/app-error.js";
import { normalizeTerm } from "../../shared/term.js";
import {
  SearchHistoryRepository,
  type SearchHistoryClear,
  type SearchRecord,
} from "./search-history.repository.js";

const maxClientClockLeadMs = 5 * 60_000;

/** Client times order the history, so one far ahead would pin a term or hide later searches. */
function clientTime(value: string): string {
  const ms = Date.parse(value);
  if (ms > Date.now() + maxClientClockLeadMs)
    throw new AppError("bad_request", { message: "Time is ahead of the server clock" });
  return new Date(ms).toISOString();
}

function reusedId(): AppError {
  return new AppError("conflict", { message: "ID was reused with different content" });
}

@Injectable()
export class SearchHistoryService {
  constructor(private readonly history: SearchHistoryRepository) {}

  recent(limit: number): string[] {
    return this.history.recentTerms(limit);
  }

  record(search: SearchRecord): SearchRecord {
    const { term, key } = normalizeTerm(search.term);
    if (!key) throw new AppError("bad_request", { message: "Term is required" });
    const searchedAt = clientTime(search.searchedAt);
    const stored = this.history.appendSearch({ id: search.id, term, termKey: key, searchedAt });
    if (stored.term !== term || stored.searchedAt !== searchedAt) throw reusedId();
    return stored;
  }

  clear(clear: SearchHistoryClear): SearchHistoryClear {
    const clearedAt = clientTime(clear.clearedAt);
    const stored = this.history.appendClear({ id: clear.id, clearedAt });
    if (stored.clearedAt !== clearedAt) throw reusedId();
    return stored;
  }
}
