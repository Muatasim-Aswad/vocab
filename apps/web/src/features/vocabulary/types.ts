import type { ApiClient } from "@vocab/api-client";

export type EntryDetail = Awaited<ReturnType<ApiClient["getEntry"]>>;
export type Entry = EntryDetail["entry"];
export type EntrySummary = EntryDetail["siblings"][number];
export type SearchItem = Awaited<ReturnType<ApiClient["searchEntries"]>>["items"][number];
export type RelationType = EntryDetail["relations"][number]["type"];
export type Prepared = Awaited<ReturnType<ApiClient["prepareEntry"]>>;
export type CreateBody = Parameters<ApiClient["createEntry"]>[0];
export type UpdateBody = Parameters<ApiClient["updateEntry"]>[1];
export type Capture = Awaited<ReturnType<ApiClient["createCapture"]>>;
export type CapturePage = Awaited<ReturnType<ApiClient["listCaptures"]>>;
export type GenerateBody = Parameters<ApiClient["generateDraft"]>[0];
export type GeneratedDraft = Awaited<ReturnType<ApiClient["generateDraft"]>>["drafts"][number];
export type MeaningMatch = Awaited<ReturnType<ApiClient["matchMeaning"]>>;
export type ConstructionType = NonNullable<CreateBody["entry"]["constructionType"]>;

export const relationTypes = [
  "related",
  "synonym",
  "antonym",
  "wordFamily",
  "posVariation",
] as const satisfies readonly RelationType[];

export const partsOfSpeech = [
  "NOUN",
  "VERB",
  "ADJ",
  "ADV",
  "PRON",
  "DET",
  "ADP",
  "CCONJ",
  "SCONJ",
  "INTJ",
  "PROPN",
  "NUM",
  "PART",
] as const;

export const constructionTypes = [
  "verbal phrase",
  "noun phrase",
  "adverbial phrase",
  "prepositional phrase",
  "conjunctional phrase",
  "participle phrase",
  "clause",
  "clause fragment",
  "indefinite pronoun phrase",
] as const satisfies readonly ConstructionType[];
