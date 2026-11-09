import type { EntryAliasKind, VocabEntry } from "./vocab.types.js";
import { formatDisplayTerm } from "./word-normalization.js";

export type EntryAliasRow = {
  entryId: number;
  kind: EntryAliasKind;
  alias: string;
};

export function normalizeAliasText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addAlias(
  rows: EntryAliasRow[],
  seen: Set<string>,
  entryId: number,
  kind: EntryAliasKind,
  rawAlias: string,
): void {
  const alias = normalizeAliasText(rawAlias);
  if (!alias) {
    return;
  }

  if (seen.has(alias)) {
    return;
  }

  seen.add(alias);
  rows.push({ entryId, kind, alias });
}

export function buildEntryAliases(entry: VocabEntry): EntryAliasRow[] {
  const rows: EntryAliasRow[] = [];
  const seen = new Set<string>();

  addAlias(rows, seen, entry.id, "lemma", entry.lemma);
  addAlias(rows, seen, entry.id, "variant", formatDisplayTerm(entry));

  for (const form of entry.forms ?? []) {
    addAlias(rows, seen, entry.id, "form", form);
  }

  return rows;
}
