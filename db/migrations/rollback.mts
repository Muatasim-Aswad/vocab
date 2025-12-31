#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

type AnyRecord = Record<string, unknown>;
type RollbackArgs = Record<string, boolean | string | number | undefined>;

function usage() {
  console.log(`
Rollback VOCAB_DATA_PATH to a selected backup.

Reads:  VOCAB_DATA_PATH=/path/to/data.json
Writes: overwrites VOCAB_DATA_PATH (after creating a rollback backup)

Usage:
  VOCAB_DATA_PATH=./db/data.json tsx db/migrations/rollback.mts data.json.bak-20251230-223543
  VOCAB_DATA_PATH=./db/data.json tsx db/migrations/rollback.mts data.json.bak-20251230-223543 --dry-run

Flags:
  --dry-run
  --backup-dir=/path/to/dir   (default: ./db/migrations/backups)
`);
}

const dataFilePath = process.env.VOCAB_DATA_PATH;

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

function kebabToCamel(key: string) {
  return key.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function parseCliArgs(argv: string[]) {
  const flags: RollbackArgs = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith("--no-")) {
      flags[kebabToCamel(token.slice("--no-".length))] = false;
      continue;
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const eqIndex = withoutPrefix.indexOf("=");
      if (eqIndex !== -1) {
        const rawKey = withoutPrefix.slice(0, eqIndex);
        const rawValue = withoutPrefix.slice(eqIndex + 1);
        flags[kebabToCamel(rawKey)] = rawValue;
        continue;
      }

      const rawKey = withoutPrefix;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[kebabToCamel(rawKey)] = next;
        i++;
      } else {
        flags[kebabToCamel(rawKey)] = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      for (const ch of token.slice(1)) flags[ch] = true;
    }
  }

  return { flags, positional };
}

function isArrayOfObjects(x: unknown): x is AnyRecord[] {
  return Array.isArray(x) && x.every((v) => v && typeof v === "object");
}

function toWordMap(entries: AnyRecord[]) {
  const map = new Map<string, AnyRecord>();
  for (const entry of entries) {
    const word = entry.word;
    if (typeof word === "string" && word.trim()) map.set(word, entry);
  }
  return map;
}

function stableJson(value: unknown): string {
  const primitive = (v: unknown) => {
    const json = JSON.stringify(v);
    return json === undefined ? "null" : json;
  };

  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return primitive(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${primitive(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

function resolveBackupPath(backupArg: string, backupDir: string) {
  if (backupArg.includes("/") || backupArg.includes("\\")) {
    return path.resolve(process.cwd(), backupArg);
  }
  return path.resolve(backupDir, backupArg);
}

function isMain() {
  const argvHref = process.argv[1]
    ? pathToFileURL(process.argv[1]).href
    : undefined;
  return argvHref === import.meta.url;
}

if (isMain()) {
  try {
    if (!dataFilePath) {
      console.error("Error: Environment variable VOCAB_DATA_PATH is not set.");
      usage();
      process.exit(1);
    }

    const { flags, positional } = parseCliArgs(process.argv.slice(2));
    const backupArg = positional[0];

    if (flags.help || flags.h) {
      usage();
      process.exit(0);
    }

    if (!backupArg) {
      console.error("Error: missing backup file argument.");
      usage();
      process.exit(1);
    }

    const dryRun = flags.dryRun === true;
    const backupDirRaw =
      typeof flags.backupDir === "string" && flags.backupDir.trim()
        ? flags.backupDir.trim()
        : "./db/migrations/backups";
    const backupDir = path.resolve(process.cwd(), backupDirRaw);
    const backupPath = resolveBackupPath(backupArg, backupDir);

    if (!fs.existsSync(backupPath)) {
      console.error(`Error: backup file not found: ${backupPath}`);
      process.exit(1);
    }

    const currentRaw = fs.readFileSync(dataFilePath, "utf8");
    const backupRaw = fs.readFileSync(backupPath, "utf8");

    let overviewPrinted = false;
    try {
      const currentParsed: unknown = JSON.parse(currentRaw);
      const backupParsed: unknown = JSON.parse(backupRaw);

      if (isArrayOfObjects(currentParsed) && isArrayOfObjects(backupParsed)) {
        const currentMap = toWordMap(currentParsed);
        const backupMap = toWordMap(backupParsed);

        let added = 0;
        let removed = 0;
        let modified = 0;

        for (const [word, currentEntry] of currentMap.entries()) {
          const backupEntry = backupMap.get(word);
          if (!backupEntry) {
            added++;
            continue;
          }
          if (stableJson(currentEntry) !== stableJson(backupEntry)) modified++;
        }

        for (const word of backupMap.keys()) {
          if (!currentMap.has(word)) removed++;
        }

        console.log(`Current entries: ${currentParsed.length}`);
        console.log(`Backup entries:  ${backupParsed.length}`);
        console.log(`Diff (by word): +${added}  -${removed}  ~${modified}`);
        overviewPrinted = true;
      }
    } catch {
      // ignore overview failures (still can rollback by bytes)
    }

    if (!overviewPrinted) {
      console.log(`Current bytes: ${Buffer.byteLength(currentRaw, "utf8")}`);
      console.log(`Backup bytes:  ${Buffer.byteLength(backupRaw, "utf8")}`);
    }

    const rollbackBackupPath = path.join(
      backupDir,
      `${path.basename(dataFilePath)}.bak-rollback-${timestampForFilename()}`,
    );

    if (dryRun) {
      console.log(`Dry run: would write rollback backup at: ${rollbackBackupPath}`);
      console.log(`Dry run: would restore ${dataFilePath} from: ${backupPath}`);
      process.exit(0);
    }

    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(rollbackBackupPath, currentRaw, "utf8");
    fs.writeFileSync(dataFilePath, backupRaw, "utf8");

    console.log(`Rollback backup written to: ${rollbackBackupPath}`);
    console.log(`Restored ${dataFilePath} from: ${backupPath}`);
  } catch (error) {
    console.error("Rollback failed:", error);
    process.exit(1);
  }
}
