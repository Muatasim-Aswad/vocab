import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { Database } from "../src/infra/db/database.js";
import { notes } from "./fixtures/notes.schema.js";
import { generateFixtureMigrations, tempDir } from "./support.js";

describe("Database (better-sqlite3 + Drizzle, disposable file)", () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let migrationsFolder: string;

  beforeAll(() => {
    dir = tempDir();
    path = join(dir.dir, "nested", "vocab.db");
    migrationsFolder = join(dir.dir, "migrations");
    generateFixtureMigrations(migrationsFolder, "--name", "notes");
  });

  afterAll(() => dir.cleanup());

  it("refuses to create a database implicitly", () => {
    expect(() => new Database({ path, migrationsFolder })).toThrow();
  });

  it("creates, migrates, writes, and closes", () => {
    const database = new Database({ path, migrationsFolder, create: true });
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.migrationState()).toMatchObject({ status: "pending", applied: 0 });

    const applied = database.migrate();
    expect(applied).toEqual([expect.stringMatching(/^\d{14}_notes$/)]);
    expect(database.migrationState()).toEqual({
      status: "ok",
      applied: 1,
      pending: [],
      diverged: [],
    });

    database.orm.insert(notes).values({ id: 1, body: "first" }).run();
    database.close();
    database.close();
  });

  it("reopens the existing file with data and history intact", () => {
    const database = new Database({ path, migrationsFolder });
    expect(database.orm.select().from(notes).where(eq(notes.id, 1)).all()).toEqual([
      { id: 1, body: "first" },
    ]);
    expect(database.migrate()).toEqual([]);
    expect(database.ping()).toBe(true);
    database.close();
    expect(database.ping()).toBe(false);
  });

  it("applies a custom (hand-written) data migration", () => {
    generateFixtureMigrations(migrationsFolder, "--custom", "--name", "seed");
    const seed = readdirSync(migrationsFolder).find((name) => name.endsWith("_seed"));
    appendFileSync(
      join(migrationsFolder, seed!, "migration.sql"),
      "\nINSERT INTO notes (id, body) VALUES (2, 'seeded');\n",
    );

    const database = new Database({ path, migrationsFolder });
    expect(database.migrationState()).toMatchObject({ status: "pending", pending: [seed] });
    expect(database.migrate()).toEqual([seed]);
    expect(database.orm.select().from(notes).all()).toHaveLength(2);
    database.close();
  });

  it("detects an edited applied migration and refuses to migrate", () => {
    const seed = readdirSync(migrationsFolder).find((name) => name.endsWith("_seed"))!;
    writeFileSync(join(migrationsFolder, seed, "migration.sql"), "-- edited after being applied\n");

    const database = new Database({ path, migrationsFolder });
    expect(database.migrationState()).toMatchObject({ status: "diverged", diverged: [seed] });
    expect(() => database.migrate()).toThrow(/differ from the shipped files/);
    database.close();
  });

  it("treats an absent migrations folder as nothing to apply", () => {
    const empty = new Database({
      path: join(dir.dir, "empty.db"),
      migrationsFolder: join(dir.dir, "none"),
      create: true,
    });
    expect(empty.migrate()).toEqual([]);
    expect(empty.migrationState()).toEqual({ status: "ok", applied: 0, pending: [], diverged: [] });
    empty.close();
  });
});
