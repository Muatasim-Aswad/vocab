import { Injectable } from "@nestjs/common";

import { Database } from "../../infra/db/database.js";

export interface SearchRecord {
  id: string;
  term: string;
  searchedAt: string;
}

export interface SearchHistoryClear {
  id: string;
  clearedAt: string;
}

@Injectable()
export class SearchHistoryRepository {
  constructor(private readonly database: Database) {}

  /** Appends unless the ID exists; returns the stored row either way. */
  appendSearch(search: SearchRecord & { termKey: string }): SearchRecord {
    this.database.sqlite
      .prepare(
        "INSERT INTO search_history (id, term, term_key, searched_at) VALUES (@id, @term, @termKey, @searchedAt) ON CONFLICT(id) DO NOTHING",
      )
      .run(search);
    return this.database.sqlite
      .prepare<[string], SearchRecord>(
        "SELECT id, term, searched_at AS searchedAt FROM search_history WHERE id = ?",
      )
      .get(search.id)!;
  }

  /** Appends unless the ID exists; returns the stored row either way. */
  appendClear(clear: SearchHistoryClear): SearchHistoryClear {
    this.database.sqlite
      .prepare(
        "INSERT INTO search_history_clears (id, cleared_at) VALUES (@id, @clearedAt) ON CONFLICT(id) DO NOTHING",
      )
      .run(clear);
    return this.database.sqlite
      .prepare<[string], SearchHistoryClear>(
        "SELECT id, cleared_at AS clearedAt FROM search_history_clears WHERE id = ?",
      )
      .get(clear.id)!;
  }

  /** Distinct terms after the latest clear, newest first; SQLite takes `term` from the newest row. */
  recentTerms(limit: number): string[] {
    const rows = this.database.sqlite
      .prepare<[number], { term: string }>(
        `SELECT term, MAX(searched_at) AS lastSearchedAt FROM search_history
         WHERE searched_at > COALESCE((SELECT MAX(cleared_at) FROM search_history_clears), '')
         GROUP BY term_key ORDER BY lastSearchedAt DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((row) => row.term);
  }
}
