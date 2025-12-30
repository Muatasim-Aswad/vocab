#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { DEFAULT_DIFFICULTY, DEFAULT_STRENGTH } from "./data/memory/memory.mjs";

type AnyRecord = Record<string, unknown>;

function usage() {
  console.log(`
Migrate vocab study tracking to the memory model fields.

Reads:  VOCAB_DATA_PATH=/path/to/data.json
Writes: overwrites the JSON file (after creating a timestamped backup)

Changes per entry:
- removes: memorizationStrength, lastReviewed
- sets: memoryStrength=${DEFAULT_STRENGTH}, memoryDifficulty=${DEFAULT_DIFFICULTY}, memoryStreak=0
- removes: memoryLastReviewed (so all items start as "never reviewed" by default)

Usage:
  VOCAB_DATA_PATH=./data.json node dist/migrateMemoryState.mjs
  VOCAB_DATA_PATH=./data.json node dist/migrateMemoryState.mjs --dry-run
  VOCAB_DATA_PATH=./data.json node dist/migrateMemoryState.mjs --keep-last-reviewed
`);
}

const dataFilePath = process.env.VOCAB_DATA_PATH;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const keepLastReviewed = args.has("--keep-last-reviewed");

if (!dataFilePath) {
  console.error("Error: Environment variable VOCAB_DATA_PATH is not set.");
  usage();
  process.exit(1);
}

if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

function timestampForFilename(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function isArrayOfObjects(x: unknown): x is AnyRecord[] {
  return Array.isArray(x) && x.every((v) => v && typeof v === "object");
}

try {
  const raw = fs.readFileSync(dataFilePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!isArrayOfObjects(parsed)) {
    console.error("Error: expected the data file to be a JSON array of objects.");
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  let changed = 0;

  const migrated = parsed.map((entry) => {
    const next: AnyRecord = { ...entry };

    const hadOldFields =
      "memorizationStrength" in next || "lastReviewed" in next;

    const oldLastReviewed = next.lastReviewed;

    delete next.memorizationStrength;
    delete next.lastReviewed;

    next.memoryStrength = DEFAULT_STRENGTH;
    next.memoryDifficulty = DEFAULT_DIFFICULTY;
    next.memoryStreak = 0;

    // Start from defaults as "never reviewed" unless explicitly preserved.
    if (keepLastReviewed && typeof oldLastReviewed === "string") {
      next.memoryLastReviewed = oldLastReviewed;
    } else {
      delete next.memoryLastReviewed;
    }

    // Mark schema change
    next.modifiedAt = nowIso;

    if (hadOldFields) changed++;
    return next;
  });

  const backupPath = path.join(
    path.dirname(dataFilePath),
    `${path.basename(dataFilePath)}.bak-${timestampForFilename()}`,
  );

  if (dryRun) {
    console.log(
      `Dry run: would migrate ${migrated.length} entries (${changed} had old study fields).`,
    );
    console.log(`Dry run: would create backup at: ${backupPath}`);
    process.exit(0);
  }

  fs.writeFileSync(backupPath, raw, "utf8");
  fs.writeFileSync(dataFilePath, JSON.stringify(migrated, null, 2), "utf8");

  console.log(
    `Migrated ${migrated.length} entries (${changed} had old study fields).`,
  );
  console.log(`Backup written to: ${backupPath}`);
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
