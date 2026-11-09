import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authSessionsTable = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    secretHash: text("secret_hash").notNull(),
    tokenFingerprint: text("token_fingerprint").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [index("auth_sessions_token_fingerprint_idx").on(table.tokenFingerprint)],
);
