import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const importReceiptTable = sqliteTable("legacy_import_receipt", {
  id: integer("id").primaryKey(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  sourceSchema: text("source_schema").notNull(),
  reportJson: text("report_json").notNull(),
  importedAt: text("imported_at").notNull(),
});
