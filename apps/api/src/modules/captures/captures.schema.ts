import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const capturesTable = sqliteTable(
  "captures",
  {
    id: text("id").primaryKey(),
    term: text("term").notNull(),
    termKey: text("term_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("captures_term_key_unique").on(table.termKey),
    index("captures_created_at_id_idx").on(table.createdAt, table.id),
  ],
);
