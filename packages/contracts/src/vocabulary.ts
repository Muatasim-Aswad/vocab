import { z } from "zod";

import { aiProvenance } from "./ai-provenance.ts";
import { cursorPage } from "./pagination.ts";
import { entryId, utcTimestamp, uuidV7 } from "./primitives.ts";

export const relationType = z.enum(["synonym", "antonym", "wordFamily", "posVariation", "related"]);
const constructionType = z.enum([
  "verbal phrase",
  "noun phrase",
  "adverbial phrase",
  "prepositional phrase",
  "conjunctional phrase",
  "participle phrase",
  "clause",
  "clause fragment",
  "indefinite pronoun phrase",
]);
export const entry = z.object({
  id: entryId,
  revision: z.int().positive(),
  lemma: z.string(),
  status: z.enum(["active", "stub"]).optional(),
  senseCue: z.string().optional(),
  extra: z.string().optional(),
  language: z.string(),
  partOfSpeech: z.string().optional(),
  grammar: z.record(z.string(), z.unknown()).optional(),
  isMultiWord: z.boolean().optional(),
  relations: z.array(z.object({ type: relationType, targetEntryId: entryId })).optional(),
  examples: z.array(z.string()).optional(),
  collocations: z.array(z.string()).optional(),
  constructionType: constructionType.optional(),
  tags: z.array(z.string()).optional(),
  forms: z.array(z.string()).optional(),
  memory: z
    .object({
      strength: z.number(),
      difficulty: z.number(),
      streak: z.int(),
      lastReviewed: utcTimestamp,
    })
    .optional(),
  meta: z.object({ addedAt: utcTimestamp, modifiedAt: utcTimestamp }),
});

/** Summaries carry the noun article, so linked words display like headwords. */
export const entrySummary = entry
  .pick({
    id: true,
    revision: true,
    lemma: true,
    status: true,
    senseCue: true,
    partOfSpeech: true,
    extra: true,
  })
  .extend({ article: z.enum(["de", "het"]).optional() });
const entryRelation = z.object({ type: relationType, entry: entrySummary });
export const entryDetail = z.object({
  entry,
  relations: z.array(entryRelation),
  siblings: z.array(entrySummary),
  /** Particle that splits off a separable verb ("op" for "opstaan"); omitted when the stored forms don't show one. */
  separablePart: z.string().optional(),
});
/** Result rows add examples, so every entry list can show one; stubs add the words related to them instead. */
const entryListItem = entrySummary.extend({
  examples: entry.shape.examples,
  relations: z.array(entryRelation).optional(),
});
export const entryPage = cursorPage(entryListItem).extend({ total: z.int().nonnegative() });
export const entryInput = z.object({
  lemma: z.string().min(1),
  senseCue: z.string().optional(),
  extra: z.string().optional(),
  language: z.string().optional(),
  status: z.enum(["active", "stub"]).optional(),
  partOfSpeech: z.string().optional(),
  grammar: z.record(z.string(), z.unknown()).optional(),
  isMultiWord: z.boolean().optional(),
  relatedTokens: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  collocations: z.array(z.string()).optional(),
  constructionType: constructionType.optional(),
  tags: z.array(z.string()).optional(),
  forms: z.array(z.string()).optional(),
});
export const createEntryBody = z.object({
  mutationId: uuidV7,
  ai: aiProvenance.optional(),
  /** Consume this capture in the same transaction as a successful entry write. */
  captureId: uuidV7.optional(),
  entry: entryInput,
  senseCueBackfills: z
    .array(
      z.object({ id: entryId, expectedRevision: z.int().positive(), senseCue: z.string().min(1) }),
    )
    .default([]),
});
export const updateEntryBody = z.object({
  mutationId: uuidV7,
  ai: aiProvenance.optional(),
  captureId: uuidV7.optional(),
  expectedRevision: z.int().positive(),
  changes: entryInput.partial().omit({ language: true }),
});
export const deleteEntryBody = z.object({
  mutationId: uuidV7,
  expectedRevision: z.int().positive(),
});
export const entryIdParams = z.object({ id: z.coerce.number().int().positive() });
export const entryQuery = z.object({ term: z.string().min(1) });
const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  typeFilter: z.string().optional(),
});
/** `added`: newest first; `modified`: latest content change first; `alphabetical`: by lemma. */
export const listEntriesQuery = listQuery.extend({
  order: z.enum(["added", "modified", "alphabetical"]).default("added"),
});
export const searchQuery = listQuery.extend({
  query: z.string().min(1),
  includeAllFields: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
});
export const prepareEntryBody = z.object({ term: z.string().min(1) });
export const resolveFormsBody = z.object({
  term: z.string().min(1),
  partOfSpeech: z.string().optional(),
  providedForms: z.array(z.string()).optional(),
  irregular: z.boolean().optional(),
  separable: z.boolean().optional(),
});
export const formsResolution = z.object({
  providedForms: z.array(z.string()).optional(),
  inferredForms: z.array(z.string()).optional(),
  conflict: z.boolean(),
});
export const preparedEntry = z.object({
  term: z.string(),
  matches: z.array(entryListItem),
  /** Other entries listing the term among their forms: it may be one of their forms, not a new word. */
  formOf: z.array(entryListItem).default([]),
  inferred: entryInput.partial(),
});

export type Entry = z.output<typeof entry>;
