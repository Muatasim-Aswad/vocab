export const multiwordSystemInstruction = `You generate JSON for a Dutch multiword term.
Return a JSON array of objects only (no code fences, no extra text). If the term has one sense, return an array with one object. If it has multiple distinct senses, return one object per sense, each with the same term and a distinct senseCue.

Be accurate and follow standard Dutch usage. Do not invent meanings.

Keys: term, corrected, senseCue, examples, relations, collocations, tags, constructionType, extra.

Rules:
- term: the canonical phrase form (lemma). Normalize to canonical form: verbal phrases to infinitive, standard word order, correct function words.
- corrected: true if the output term differs from the raw input for any reason (spelling fix, canonical form, word order, or function word correction).
- senseCue: optional one-word Dutch disambiguation cue naming a domain or category (a noun or verb). Only when the term has multiple distinct senses; keep it minimal and non-revealing.
- examples: array of Dutch sentences. Simple learner-friendly language, but natural, idiomatic, modern Dutch. Each example gives enough context to make the meaning clear. Usually exactly 1 example; 2 only for subtle nuance that does NOT warrant a separate sense.
- relations: array of {type, term}. term is always the bare lemma — no de/het, no zich. Types: synonym, antonym, related.
  - synonym must be near-substitutable in most contexts. If substitution noticeably changes the meaning, use related.
  - do NOT include inflected forms.
- collocations: common combinations that include the term. Only frequent, conventional combinations.
- constructionType: one of verbal phrase, noun phrase, adverbial phrase, prepositional phrase, conjunctional phrase, participle phrase, clause, clause fragment, indefinite pronoun phrase.
- tags: optional array of lexical/custom tags (non-grammar), e.g. idiom, proverb, expression, metaphor.
- extra: concise English meaning plus terminology/word parts or memory hints.

Omit fields that are genuinely not applicable.
`;

export const multiwordResponseJsonSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      term: { type: "string" },
      corrected: { type: "boolean" },
      senseCue: { type: "string" },
      examples: { type: "array", items: { type: "string" } },
      relations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["synonym", "antonym", "related"],
            },
            term: { type: "string" },
          },
          required: ["type", "term"],
        },
      },
      collocations: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      constructionType: {
        type: "string",
        enum: [
          "verbal phrase",
          "noun phrase",
          "adverbial phrase",
          "prepositional phrase",
          "conjunctional phrase",
          "participle phrase",
          "clause",
          "clause fragment",
          "indefinite pronoun phrase",
        ],
      },
      extra: { type: "string" },
    },
    required: ["term", "corrected"],
  },
} as const;
