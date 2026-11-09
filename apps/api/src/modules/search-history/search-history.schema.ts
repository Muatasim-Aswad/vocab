import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const searchHistoryTable = sqliteTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    term: text("term").notNull(),
    termKey: text("term_key").notNull(),
    searchedAt: text("searched_at").notNull(),
  },
  (table) => [index("search_history_searched_at_idx").on(table.searchedAt)],
);

export const searchHistoryClearsTable = sqliteTable("search_history_clears", {
  id: text("id").primaryKey(),
  clearedAt: text("cleared_at").notNull(),
});
