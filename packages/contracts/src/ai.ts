import { z } from "zod";

import { entryId, uuidV7 } from "./primitives.ts";
import { entryInput, relationType } from "./vocabulary.ts";

const senseHint = z
  .object({ senseCue: z.string().min(1).optional(), example: z.string().min(1).optional() })
  .refine((sense) => sense.senseCue || sense.example, "Give a sense cue or an example.");
export const generateBody = z.object({
  requestId: uuidV7,
  term: z.string().min(1),
  allowExisting: z.boolean().default(false),
  excludeSenses: z.array(senseHint).optional(),
  requestedSense: senseHint.optional(),
});
export const aiDraft = entryInput.partial().extend({
  draftId: uuidV7.optional(),
  term: z.string().min(1),
  corrected: z.boolean(),
  relations: z.array(z.object({ type: relationType, term: z.string() })).optional(),
  irregular: z.boolean().optional(),
  separable: z.boolean().optional(),
  uncountable: z.boolean().optional(),
});
export const generateResponse = z.object({
  /** Absent only for successful receipts written before AI auditing existed. */
  generationId: uuidV7.optional(),
  drafts: z.array(aiDraft),
  warnings: z.array(z.string()),
  existing: z.array(
    z.object({ id: z.int().positive(), lemma: z.string(), senseCue: z.string().optional() }),
  ),
});

const filledText = z.string().trim().min(1);
/** A candidate meaning: its term and at least one field that says what it means. */
const meaningCandidate = z
  .object({
    term: filledText,
    senseCue: filledText.optional(),
    extra: filledText.optional(),
    partOfSpeech: filledText.optional(),
    examples: z.array(filledText).optional(),
  })
  .refine((draft) => draft.extra || draft.examples?.length, "Give notes or an example.");
export const matchMeaningBody = z.object({
  requestId: uuidV7,
  /** The AI draft the candidate came from, for the audit trail. */
  draftId: uuidV7.optional(),
  draft: meaningCandidate,
  /** Existing entries of the draft's term to compare it with. */
  entryIds: z.array(entryId).min(1).max(20),
});
const matchBasis = {
  reason: z.string(),
  /** The entry revisions the decision was made against. */
  compared: z.array(z.object({ id: entryId, revision: z.int().positive() })),
};
export const meaningMatch = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("same"), entryId, ...matchBasis }),
  z.object({
    decision: z.literal("new"),
    senseCue: z.string(),
    /** Labels for the compared entries that have none. */
    backfills: z.array(z.object({ id: entryId, senseCue: z.string() })),
    ...matchBasis,
  }),
]);

export const aiDraftEventBody = z.object({
  eventId: uuidV7,
  draftId: uuidV7,
  eventType: z.enum(["presented", "skipped"]),
  editableBaseline: z.record(z.string(), z.unknown()).optional(),
});
export const aiDraftEventResponse = z.object({ recorded: z.literal(true) });
