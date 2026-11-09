import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Fixture table proving the migration path; not part of the application schema. */
export const notes = sqliteTable("notes", {
  id: integer().primaryKey(),
  body: text().notNull(),
});
