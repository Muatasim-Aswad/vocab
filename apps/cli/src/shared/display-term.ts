import type { Entry } from "@vocab/contracts";

type Displayable = Pick<Entry, "lemma" | "isMultiWord" | "grammar">;

/** Restores the article or `zich` prefix the API stores as grammar. */
export function formatDisplayTerm(entry: Displayable): string {
  if (entry.isMultiWord) return entry.lemma;
  const grammar = entry.grammar as { article?: unknown; isReflexive?: unknown } | undefined;
  if (typeof grammar?.article === "string") return `${grammar.article} ${entry.lemma}`;
  if (grammar?.isReflexive === true) return `zich ${entry.lemma}`;
  return entry.lemma;
}

export type EntryLookup = (id: number) => Entry | null;
