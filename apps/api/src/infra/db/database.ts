import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

export interface DatabaseOptions {
  /** Absolute SQLite file path. */
  path: string;
  migrationsFolder: string;
  /** Create the file (and its folder) when missing. Only the migration command sets this. */
  create?: boolean;
  /** Inspection only: no writes, schema changes or journal-mode switch. */
  readonly?: boolean;
  /**
   * Offline tools: hold an exclusive lock for the connection's lifetime. Fails while any other
   * connection (such as a running API) has the database open.
   */
  exclusive?: boolean;
}

export interface MigrationState {
  /** `pending`: shipped but not applied; `diverged`: applied history differs from the shipped files. */
  status: "ok" | "pending" | "diverged";
  applied: number;
  pending: string[];
  diverged: string[];
}

/** Drizzle's migration history table. */
const migrationsTable = "__drizzle_migrations";

const appliedRows = z.array(z.object({ name: z.string(), hash: z.string() }));

/** One owned SQLite connection with its Drizzle instance. */
export class Database {
  readonly sqlite: BetterSqlite3.Database;
  readonly orm: BetterSQLite3Database;
  private readonly migrationsFolder: string;

  constructor({
    path,
    migrationsFolder,
    create = false,
    readonly = false,
    exclusive = false,
  }: DatabaseOptions) {
    if (create) mkdirSync(dirname(path), { recursive: true });
    else if (!existsSync(path))
      throw new Error(`No database at ${path}; run the migration command first`);
    this.sqlite = new BetterSqlite3(path, { fileMustExist: !create, readonly, timeout: 5000 });
    if (readonly) this.sqlite.pragma("query_only = ON");
    else {
      if (exclusive) {
        this.sqlite.pragma("locking_mode = EXCLUSIVE");
        try {
          // Takes the lock now; in WAL mode it fails while another connection is open.
          this.sqlite.pragma("busy_timeout = 1000");
          this.sqlite.exec("BEGIN EXCLUSIVE; COMMIT");
          this.sqlite.pragma("busy_timeout = 5000");
        } catch (error) {
          this.sqlite.close();
          throw new Error("Database is in use; stop the API and other writers first", {
            cause: error,
          });
        }
      }
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.pragma("synchronous = NORMAL");
    }
    this.sqlite.pragma("foreign_keys = ON");
    this.orm = drizzle({ client: this.sqlite });
    this.migrationsFolder = migrationsFolder;
  }

  /** True when the connection answers a query. */
  ping(): boolean {
    try {
      this.sqlite.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  migrationState(): MigrationState {
    const local = this.localMigrations();
    const applied = this.appliedMigrations();
    const localHashes = new Map(local.map((migration) => [migration.name, migration.hash]));
    const appliedNames = new Set(applied.map((migration) => migration.name));

    const pending = local
      .filter((migration) => !appliedNames.has(migration.name))
      .map((m) => m.name);
    const diverged = applied
      .filter((migration) => localHashes.get(migration.name) !== migration.hash)
      .map((migration) => migration.name);
    const status = diverged.length ? "diverged" : pending.length ? "pending" : "ok";
    return { status, applied: applied.length, pending, diverged };
  }

  /** Applies pending migrations in one transaction; refuses diverged history. Returns applied names. */
  migrate(): string[] {
    const before = this.migrationState();
    if (before.status === "diverged") {
      throw new Error(
        `Applied migrations differ from the shipped files: ${before.diverged.join(", ")}`,
      );
    }
    if (before.pending.length) migrate(this.orm, { migrationsFolder: this.migrationsFolder });
    return before.pending;
  }

  close(): void {
    if (this.sqlite.open) this.sqlite.close();
  }

  private localMigrations() {
    if (!existsSync(this.migrationsFolder)) return [];
    return readMigrationFiles({ migrationsFolder: this.migrationsFolder });
  }

  private appliedMigrations(): { name: string; hash: string }[] {
    const table = this.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(migrationsTable);
    if (!table) return [];
    return appliedRows.parse(
      this.sqlite.prepare(`SELECT name, hash FROM "${migrationsTable}" ORDER BY id`).all(),
    );
  }
}
