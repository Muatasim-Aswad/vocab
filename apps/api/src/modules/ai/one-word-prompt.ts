export const oneWordSystemInstruction = `You generate JSON for a Dutch single-word lemma.
Return a JSON array of objects only (no code fences, no extra text). If the lemma has one sense, return an array with one object. If it has multiple distinct senses, return one object per sense, each with the same term and a distinct senseCue. Split senses whenever an English learner needs a different translation, including a fixed or impersonal construction with its own meaning (geven: give vs. het geeft niet = never mind). A reflexive and a non-reflexive use are separate senses; the reflexive sense's term starts with zich. Merge nuances that share one translation. Before deciding, consider the word's common fixed expressions and impersonal uses: each that a learner would translate differently is its own sense.

Be accurate and follow standard Dutch usage. Do not invent forms or meanings.

Keys: term, corrected, senseCue, examples, relations, collocations, partOfSpeech, tags, forms, irregular, separable, uncountable, extra.

Rules:
- term: the lemma (dictionary form). Normalize inflected input: infinitive for verbs, base for adjectives, singular for countable nouns (plural-only nouns stay plural). Keep the article (de/het) for nouns and \`zich\` for reflexive verbs when they belong to the term.
- corrected: true if the output term differs from the raw input for any reason (spelling fix, normalization, or prefix addition).
- senseCue: optional one-word Dutch disambiguation cue naming a domain or category (a noun or verb). Only when the lemma has multiple distinct senses; keep it minimal and non-revealing: never a synonym or translation of the sense, nor a word in its relations (slot as a castle: gebouw, not kasteel).
- examples: array of Dutch sentences. Simple learner-friendly language, but natural, idiomatic, modern Dutch. Each example gives enough context to make the meaning of the term clear. Usually exactly 1 example; 2 only for subtle nuance that does NOT warrant a separate sense.
- relations: array of {type, term}. term is always the bare lemma — no de/het, no zich. Types: synonym, antonym, wordFamily, posVariation, related.
  - synonym must be near-substitutable in most contexts. If substitution noticeably changes the meaning, use related.
  - wordFamily shares the lexical root via derivation (prefix/suffix), not inflection. If unsure, use related.
  - do NOT include inflected forms (conjugations, plurals, diminutives).
- collocations: common combinations that include the term. Only frequent, conventional combinations, not free adjective+verb phrases.
- partOfSpeech: one of NOUN, VERB, ADJ, ADV, PRON, DET, ADP, CCONJ, SCONJ, INTJ, PROPN, NUM, PART.
- forms: bare inflected strings — no de/het, no zich. Include only complete sets; if unsure or incomplete, omit (the system can generate them).
  - VERB (no pronouns), in order: infinitive; present 1st sg; present 3rd sg; past sg; past pl; past participle; its adjective form (adds -e, except after -en: gelopen); present participle; its adjective form. Repeat shared forms.
  - Separable VERB: give split then joined for present 1st/3rd sg and past sg/pl (13 items), e.g. opbellen, bel op, opbel, belt op, opbelt, belde op, opbelde, belden op, opbelden, opgebeld, opgebelde, opbellend, opbellende.
  - NOUN: plural, diminutive, diminutive plural (when applicable).
  - ADJ: base, inflected, comparative, superlative.
- irregular: boolean when applicable.
- separable: boolean for separable single-word verbs when applicable.
- uncountable: boolean for uncountable single-word nouns when applicable.
- tags: optional array of lexical/custom tags only, and only when strongly applicable. Do not use tags for grammar or inflection. Examples: figurative, informal, slang.
- extra: concise English meaning plus terminology/word parts or memory hints.

Omit fields that are genuinely not applicable.
`;

export const oneWordResponseJsonSchema = {
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
              enum: ["synonym", "antonym", "wordFamily", "posVariation", "related"],
            },
            term: { type: "string" },
          },
          required: ["type", "term"],
        },
      },
      collocations: { type: "array", items: { type: "string" } },
      partOfSpeech: {
        type: "string",
        enum: [
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
        ],
      },
      tags: { type: "array", items: { type: "string" } },
      forms: { type: "array", items: { type: "string" } },
      irregular: { type: "boolean" },
      separable: { type: "boolean" },
      uncountable: { type: "boolean" },
      extra: { type: "string" },
    },
    required: ["term", "corrected"],
  },
} as const;
