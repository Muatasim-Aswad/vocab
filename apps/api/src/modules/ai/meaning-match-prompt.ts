export interface MatchCandidate {
  term: string;
  senseCue?: string;
  extra?: string;
  partOfSpeech?: string;
  examples?: string[];
}

interface MatchRelation {
  type: string;
  term: string;
  senseCue?: string;
}

/** An existing entry as the model sees it; a stub has only its term and relations. */
export interface MatchEntry {
  id: number;
  status: "active" | "stub";
  senseCue?: string;
  partOfSpeech?: string;
  extra?: string;
  examples?: string[];
  forms?: string[];
  relations?: MatchRelation[];
}

export const meaningMatchSystemInstruction = `You compare one candidate meaning of a Dutch term with the existing entries of that term in a learner's vocabulary.
Return one JSON object only (no code fences, no extra text).

Decide whether the candidate is the same meaning as one existing entry, or a new meaning distinct from all of them.
- same: the candidate and the entry describe the same sense. An entry may be incomplete: few fields, other examples, or a stub that holds only the term and its relations. Judge the sense, not the completeness. A different word type means a different meaning unless the entry has none.
- new: the candidate's sense differs from every entry.
An entry's relations are {type, term, senseCue}: type is synonym, antonym, wordFamily, posVariation or related; senseCue, when present, is the related entry's meaning.

Keys: decision, entryId, senseCue, backfills, reason.
- decision: "same" or "new".
- entryId: for "same" only, the id of the matching entry.
- senseCue: for "new" only, a label for the candidate's meaning.
- backfills: for "new" only, an array of {id, senseCue} with a label for every entry that has no senseCue, and for no other entry.
- reason: one short English sentence explaining the decision.

Labels: one or two lowercase Dutch words naming a domain or category (a noun or verb) that tells the meaning apart from the term's other meanings. Never the term itself. Every label of the term, existing ones included, must differ. Existing labels stay as they are.
`;

export const meaningMatchResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["same", "new"] },
    entryId: { type: "integer" },
    senseCue: { type: "string" },
    backfills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "integer" }, senseCue: { type: "string" } },
        required: ["id", "senseCue"],
      },
    },
    reason: { type: "string" },
  },
  required: ["decision", "reason"],
} as const;

/** Versioned description of the input layout used by meaningMatchInput. */
export const meaningMatchInputTemplate =
  "Term: {term}; candidate meaning as one JSON object; existing entries as one JSON object per line; sections separated by two newlines";

export function meaningMatchInput(
  term: string,
  candidate: MatchCandidate,
  entries: MatchEntry[],
): string {
  return [
    `Term: ${term}`,
    `Candidate meaning:\n${JSON.stringify(candidate)}`,
    `Existing entries:\n${entries.map((entry) => JSON.stringify(entry)).join("\n")}`,
  ].join("\n\n");
}
