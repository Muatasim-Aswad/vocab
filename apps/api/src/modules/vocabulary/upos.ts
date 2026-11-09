export const uposValues = [
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
] as const;

export type UPos = (typeof uposValues)[number];

type UPosMetadata = {
  fullNameEn: string;
  appShortcut: string;
  descriptionEn: string;
};

const UPOS_METADATA_EN: Record<UPos, UPosMetadata> = {
  ADJ: {
    fullNameEn: "adjective",
    appShortcut: "adj",
    descriptionEn: "Modifier describing a noun or pronoun.",
  },
  ADP: {
    fullNameEn: "adposition",
    appShortcut: "prep",
    descriptionEn: "Preposition or postposition linking phrases.",
  },
  ADV: {
    fullNameEn: "adverb",
    appShortcut: "adv",
    descriptionEn: "Modifier for verbs, adjectives, or clauses.",
  },
  AUX: {
    fullNameEn: "auxiliary",
    appShortcut: "aux",
    descriptionEn: "Auxiliary verb that marks tense, mood, or voice.",
  },
  CCONJ: {
    fullNameEn: "coordinating conjunction",
    appShortcut: "cc",
    descriptionEn: "Conjunction linking equal units such as words or clauses.",
  },
  DET: {
    fullNameEn: "determiner",
    appShortcut: "det",
    descriptionEn: "Determiner for nouns, such as articles and quantifiers.",
  },
  INTJ: {
    fullNameEn: "interjection",
    appShortcut: "int",
    descriptionEn: "Standalone exclamation or discourse interjection.",
  },
  NOUN: {
    fullNameEn: "noun",
    appShortcut: "n",
    descriptionEn: "Common noun naming a person, place, thing, or idea.",
  },
  NUM: {
    fullNameEn: "numeral",
    appShortcut: "num",
    descriptionEn: "Cardinal or ordinal numeral.",
  },
  PART: {
    fullNameEn: "particle",
    appShortcut: "part",
    descriptionEn: "Function particle not fitting other closed classes.",
  },
  PRON: {
    fullNameEn: "pronoun",
    appShortcut: "pron",
    descriptionEn: "Pronoun replacing or referring to noun phrases.",
  },
  PROPN: {
    fullNameEn: "proper noun",
    appShortcut: "propn",
    descriptionEn: "Proper name for unique entities.",
  },
  PUNCT: {
    fullNameEn: "punctuation",
    appShortcut: "punct",
    descriptionEn: "Punctuation mark token.",
  },
  SCONJ: {
    fullNameEn: "subordinating conjunction",
    appShortcut: "sc",
    descriptionEn: "Conjunction introducing subordinate clauses.",
  },
  SYM: {
    fullNameEn: "symbol",
    appShortcut: "sym",
    descriptionEn: "Mathematical, scientific, or other symbol token.",
  },
  VERB: {
    fullNameEn: "verb",
    appShortcut: "v",
    descriptionEn: "Main lexical verb.",
  },
  X: {
    fullNameEn: "other",
    appShortcut: "x",
    descriptionEn: "Other category for uncategorized tokens.",
  },
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveUPosFromEnglishInput(value: string): UPos | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const canonical = normalized.toUpperCase();
  const exact = uposValues.find((upos) => upos === canonical);
  if (exact) return exact;

  for (const upos of uposValues) {
    const metadata = UPOS_METADATA_EN[upos];
    if (
      normalized === metadata.fullNameEn.toLowerCase() ||
      normalized === metadata.appShortcut.toLowerCase()
    ) {
      return upos;
    }
  }

  return undefined;
}
