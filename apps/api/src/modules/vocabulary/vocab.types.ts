import type { MemoryState } from "../study/memory-state.js";

export const entryStatusValues = ["active", "stub"] as const;
type EntryStatus = (typeof entryStatusValues)[number];
// wordFamily: same-language shared root/stem with semantic continuity.
// Excludes inflection forms (entry.forms) and pure POS-shift-only links.
// posVariation: same-language POS-category shift linkage (e.g., noun <-> verb forms of the same lexeme family).
// related: unspecified lexical relation and symmetric by model rule.
// If a specific relation exists for the same pair, related should not be stored for that pair.
export const relationTypeValues = [
  "synonym",
  "antonym",
  "wordFamily",
  "posVariation",
  "related",
] as const;
export type RelationshipType = (typeof relationTypeValues)[number];
export type EntryRelation = {
  type: RelationshipType;
  targetEntryId: number;
};

// variant is another way for writing/displaying the same lemma
// aliases are unique per entry
export const aliasKindValues = ["lemma", "variant", "form", "manual"] as const;
export type EntryAliasKind = (typeof aliasKindValues)[number];

export const multiwordConstructionTypes = [
  "verbal phrase",
  "noun phrase",
  "adverbial phrase",
  "prepositional phrase",
  "conjunctional phrase",
  "participle phrase",
  "clause",
  "clause fragment",
  "indefinite pronoun phrase",
] as const;
export type MultiwordConstructionType = (typeof multiwordConstructionTypes)[number];

export type EntryGrammar = Record<string, unknown>;
export type GenericLangSpec = {
  code: string;
  partOfSpeech: string;
  grammar: Record<string, unknown>;
};

type EntryMeta = {
  addedAt: string;
  modifiedAt: string;
};

export interface VocabEntry<S extends GenericLangSpec = GenericLangSpec> {
  id: number;
  /** Monotonic optimistic concurrency revision; historical imports start at 1. */
  revision?: number;
  lemma: string;
  status?: EntryStatus;
  senseCue?: string; // short disambiguation cue (1-2 words), used in study mode for homonymous senses
  extra?: string; // optional concise meaning/notes/mnemonic text
  language: S["code"];
  partOfSpeech?: S["partOfSpeech"];
  grammar?: S["grammar"];
  isMultiWord?: boolean; // true when lemma contains more than one token and is not a noun/reflexive single-word entry
  relations?: EntryRelation[]; // id-based lexical relations (related is symmetric; specific relations suppress related for the same pair)
  examples?: string[]; // example sentences that provide contextual clues for meaning discrimination
  collocations?: string[]; // common combinations that include the term
  constructionType?: MultiwordConstructionType; // restricted structural class for multiword entries only
  tags?: string[]; // additional lexical classification (non-grammar/non-structure), e.g. "idiom", "metaphor"
  forms?: string[]; // inflected forms for single-word entries, e.g. "lopen" -> ["loop", "loopt", "liep", "gelopen"]
  memory?: MemoryState;
  meta: EntryMeta;
}

export type CreateVocabEntry<S extends GenericLangSpec = GenericLangSpec> = Pick<
  VocabEntry<S>,
  | "lemma"
  | "senseCue"
  | "extra"
  | "examples"
  | "collocations"
  | "partOfSpeech"
  | "constructionType"
  | "tags"
  | "forms"
> & {
  language?: S["code"];
  status?: EntryStatus;
  isMultiWord?: boolean;
  grammar?: S["grammar"];
  relatedTokens?: string[];
};

export type UpdateVocabEntry<S extends GenericLangSpec = GenericLangSpec> = Partial<
  Omit<CreateVocabEntry<S>, "language">
> & {
  expectedRevision?: number;
  meta?: Partial<EntryMeta>;
};

export interface Result<S extends GenericLangSpec = GenericLangSpec> {
  success: boolean;
  entry?: VocabEntry<S>;
  found?: boolean;
}

export type EntryListOrder = "added" | "modified" | "alphabetical";

export interface SearchQueryOptions {
  cursor?: number;
  limit?: number;
  typeFilter?: string;
  includeAllFields?: boolean;
}

export type PaginatedVocabEntryResult<S extends GenericLangSpec = GenericLangSpec> = {
  entries: VocabEntry<S>[];
  cursor: number;
  limit: number;
  total: number;
  startIndex: number;
  endIndex: number;
};
