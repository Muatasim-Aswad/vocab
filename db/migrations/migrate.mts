#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Vocab } from "../../src/data/repository.mts";

type AnyRecord = Record<string, unknown>;
export type MigrationArgs = Record<string, boolean | string | number | undefined>;

export type MigrationContext = {
  nowIso: string;
  index: number;
  total: number;
};

export type MigrationConverter = (
  entry: Vocab,
  args: MigrationArgs,
  ctx: MigrationContext,
) => AnyRecord;

function usage() {
  console.log(`
Generic migrator for vocab data.json entries.

Reads:  VOCAB_DATA_PATH=/path/to/data.json
Writes: overwrites the JSON file (after creating a timestamped backup)

Converter module:
- first positional arg must be: converter.<name>.mts (in this folder)
- it must export a function named 'convert' (or a default export)
- signature: (entry: Vocab, args: object, ctx: { nowIso, index, total }) => object

Usage:
  VOCAB_DATA_PATH=./db/data.json tsx db/migrations/migrate.mts converter.memoryState.mts
  VOCAB_DATA_PATH=./db/data.json tsx db/migrations/migrate.mts converter.memoryState.mts --dry-run
  VOCAB_DATA_PATH=./db/data.json tsx db/migrations/migrate.mts converter.memoryState.mts --keep-last-reviewed

Core flags:
  --dry-run
  --backup-dir=/path/to/dir   (default: ./db/migrations/backups)
`);
}

const dataFilePath = process.env.VOCAB_DATA_PATH;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

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

function kebabToCamel(key: string) {
  return key.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function parseCliArgs(argv: string[]) {
  const flags: MigrationArgs = {};
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

function normalizeName(raw: string) {
  const camelKebab = raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return camelKebab
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function isValidConverterBasename(basename: string) {
  if (basename.includes("/") || basename.includes("\\")) return false;
  if (!basename.startsWith("converter.")) return false;
  if (!basename.endsWith(".mts")) return false;
  const namePart = basename.slice("converter.".length, -".mts".length);
  return namePart.trim().length > 0;
}

function getMigrationNameFromConverter(basename: string) {
  const namePart = basename.slice("converter.".length, -".mts".length);
  const normalized = normalizeName(namePart);
  return normalized || "migration";
}

function resolveConverterPath(converterBasename: string) {
  return path.resolve(scriptDir, converterBasename);
}

async function loadConverter(converterPath: string): Promise<MigrationConverter> {
  const href = pathToFileURL(converterPath).href;
  const mod = (await import(href)) as unknown as {
    default?: unknown;
    convert?: unknown;
  };

  const fn = mod.convert ?? mod.default;
  if (typeof fn !== "function") {
    throw new Error(
      `Converter module must export a function named 'convert' (or a default export): ${converterPath}`,
    );
  }
  return fn as MigrationConverter;
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
    const converterArg = positional[0];

    if (flags.help || flags.h) {
      usage();
      process.exit(0);
    }

    if (!converterArg) {
      console.error("Error: missing converter module argument.");
      usage();
      process.exit(1);
    }

    if (!isValidConverterBasename(converterArg)) {
      console.error(
        "Error: converter must be a basename in the form: converter.<name>.mts (no paths).",
      );
      usage();
      process.exit(1);
    }

    const dryRun = flags.dryRun === true;
    const backupDirRaw =
      typeof flags.backupDir === "string" && flags.backupDir.trim()
        ? flags.backupDir.trim()
        : "./db/migrations/backups";
    const backupDir = path.resolve(process.cwd(), backupDirRaw);

    const converterPath = resolveConverterPath(converterArg);
    if (!fs.existsSync(converterPath)) {
      console.error(`Error: converter not found: ${converterPath}`);
      process.exit(1);
    }
    const convert = await loadConverter(converterPath);

    const raw = fs.readFileSync(dataFilePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!isArrayOfObjects(parsed)) {
      console.error(
        "Error: expected the data file to be a JSON array of objects.",
      );
      process.exit(1);
    }

    const nowIso = new Date().toISOString();
    const total = parsed.length;

    let changed = 0;
    const migrated = parsed.map((entry, index) => {
      const next = convert(entry as unknown as Vocab, flags, {
        nowIso,
        index,
        total,
      });
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        throw new Error(
          `Converter returned a non-object at index ${index} (word: ${(entry as AnyRecord).word ?? "unknown"})`,
        );
      }
      if (stableJson(entry) !== stableJson(next)) changed++;
      return next;
    });

    fs.mkdirSync(backupDir, { recursive: true });

    const migrationName = getMigrationNameFromConverter(converterArg);
    const backupPath = path.join(
      backupDir,
      `${path.basename(dataFilePath)}.bak-${migrationName}-${timestampForFilename()}`,
    );

    if (dryRun) {
      console.log(
        `Dry run: would migrate ${migrated.length} entries (${changed} changed).`,
      );
      console.log(`Dry run: would create backup at: ${backupPath}`);
      process.exit(0);
    }

    fs.writeFileSync(backupPath, raw, "utf8");
    fs.writeFileSync(dataFilePath, JSON.stringify(migrated, null, 2), "utf8");

    console.log(`Migrated ${migrated.length} entries (${changed} changed).`);
    console.log(`Backup written to: ${backupPath}`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}
