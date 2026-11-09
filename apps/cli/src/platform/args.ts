import { parseArgsStringToArgv } from "string-argv";
import yargsParser from "yargs-parser";

import { argsCopy } from "./args-copy.ts";

export type ParsedArgsResult<T> = { value: T; errors: string[]; warnings: string[] };

/** `cursor` keeps the legacy field name, but it is a positive page number (`-p`). */
export type ListArgs = { cursor?: number; limit: number; typeFilter?: string; showExtra?: boolean };

type SearchOptions = {
  keepWhitespace: boolean;
  cursor?: number;
  limit: number;
  includeAllFields: boolean;
  highlightAll: boolean;
  showExtra?: boolean;
  typeFilter?: string;
};

export type ParsedSearch = { query: string; options: SearchOptions };

const valueFlags = ["-p", "-l", "-ft"] as const;
const valueFlagSet = new Set<string>(valueFlags);
const searchBooleanFlags = ["-a", "-ss", "-ha", "-se", "-s", "-x", "-t"] as const;

const normalizeFlagKey = (flag: string) => flag.replace(/^-+/, "");

function parseCliInput(
  input: string,
  options: { booleanFlags: readonly string[]; valueFlags: readonly string[] },
) {
  const tokens = parseArgsStringToArgv(input);
  const flags = yargsParser(tokens, {
    boolean: options.booleanFlags.map(normalizeFlagKey),
    string: options.valueFlags.map(normalizeFlagKey),
    configuration: {
      "boolean-negation": false,
      "camel-case-expansion": false,
      "dot-notation": false,
      "duplicate-arguments-array": true,
      "greedy-arrays": false,
      "parse-numbers": false,
      "parse-positional-numbers": false,
      "short-option-groups": false,
      "unknown-options-as-args": true,
    },
  }) as Record<string, unknown>;
  const positionals = Array.isArray(flags._) ? flags._.map(String) : [];
  return { tokens, flags, positionals };
}

const hasFlag = (flags: Record<string, unknown>, flag: string) =>
  flags[normalizeFlagKey(flag)] === true;

function rawValue(tokens: string[], flag: string): { exists: boolean; value?: string } {
  const index = tokens.lastIndexOf(flag);
  return index === -1 ? { exists: false } : { exists: true, value: tokens[index + 1] };
}

function lastTokenValue(tokens: string[], flag: string): string | undefined {
  const raw = rawValue(tokens, flag);
  return raw.exists && raw.value && !raw.value.startsWith("-") ? raw.value : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  return trimmed !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function typeFilterValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripKnownFlags(
  input: string,
  booleanFlags: readonly string[],
  flagsWithValues: readonly string[],
): string {
  const patterns = [
    ...booleanFlags.map(escapeRegExp),
    ...flagsWithValues.map((flag) => `${escapeRegExp(flag)}(?:\\s+\\S+)?`),
  ];
  return input.replace(new RegExp(`(^|\\s)(?:${patterns.join("|")})(?=\\s|$)`, "g"), "");
}

/** Shared `-p`, `-l`, `-ft` handling: missing values error; invalid numbers warn. */
function pagingFlags(tokens: string[], errors: string[], warnings: string[]) {
  const typeFilterRaw = rawValue(tokens, "-ft");
  if (
    typeFilterRaw.exists &&
    (typeFilterRaw.value === undefined || valueFlagSet.has(typeFilterRaw.value))
  )
    errors.push(argsCopy.missingType);
  const typeFilter = typeFilterValue(lastTokenValue(tokens, "-ft"));

  const pageRaw = rawValue(tokens, "-p");
  const pageInput = pageRaw.value && !valueFlagSet.has(pageRaw.value) ? pageRaw.value : undefined;
  const cursor = positiveInt(pageInput);
  if (pageRaw.exists && pageInput === undefined) errors.push(argsCopy.missingPage);
  else if (pageInput !== undefined && cursor === undefined)
    warnings.push(argsCopy.invalidPage(pageInput));

  const limitRaw = rawValue(tokens, "-l");
  const limitInput =
    limitRaw.value && !valueFlagSet.has(limitRaw.value) ? limitRaw.value : undefined;
  const parsedLimit = positiveInt(limitInput);
  if (limitRaw.exists && limitInput === undefined) errors.push(argsCopy.missingLimit);
  else if (limitInput !== undefined && parsedLimit === undefined)
    warnings.push(argsCopy.invalidLimit(limitInput));

  return { cursor, limit: parsedLimit ?? 10, typeFilter };
}

export function parseListArgs(args: string): ParsedArgsResult<ListArgs> {
  const { tokens, flags } = parseCliInput(args, { booleanFlags: ["-se"], valueFlags });
  const errors: string[] = [];
  const warnings: string[] = [];
  const showExtra = hasFlag(flags, "-se");
  const { cursor, limit, typeFilter } = pagingFlags(tokens, errors, warnings);
  return {
    errors,
    warnings,
    value: { cursor, limit, typeFilter, ...(showExtra ? { showExtra: true } : {}) },
  };
}

export function parseSearchInput(input: string): ParsedArgsResult<ParsedSearch> {
  const { tokens, flags, positionals } = parseCliInput(input, {
    booleanFlags: searchBooleanFlags,
    valueFlags,
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const flag of ["-s", "-x", "-t"])
    if (hasFlag(flags, flag)) warnings.push(argsCopy.retiredFlag(flag));
  const { cursor, limit, typeFilter } = pagingFlags(tokens, errors, warnings);
  const keepWhitespace = hasFlag(flags, "-ss");
  const showExtra = hasFlag(flags, "-se");
  const query = keepWhitespace
    ? stripKnownFlags(input, searchBooleanFlags, valueFlags)
    : positionals.join(" ").trim().replace(/\s+/g, " ").toLowerCase();
  return {
    errors,
    warnings,
    value: {
      query,
      options: {
        keepWhitespace,
        cursor,
        limit,
        includeAllFields: hasFlag(flags, "-a"),
        highlightAll: hasFlag(flags, "-ha"),
        ...(showExtra ? { showExtra: true } : {}),
        typeFilter,
      },
    },
  };
}
