import { resolveUPosFromEnglishInput } from "../upos.js";

const NL_UPOS_VALUES = [
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

export type NlUPos = (typeof NL_UPOS_VALUES)[number];

const nlUposSet = new Set<string>(NL_UPOS_VALUES);

export function isNlUPos(value: unknown): value is NlUPos {
  return typeof value === "string" && nlUposSet.has(value);
}

export function resolveNlUPosFromPromptInput(value: string): NlUPos | undefined {
  const resolved = resolveUPosFromEnglishInput(value);
  if (!resolved || !isNlUPos(resolved)) {
    return undefined;
  }

  return resolved;
}

export function resolveNlUPosCandidatesForFilter(value: string): NlUPos[] {
  const resolved = resolveNlUPosFromPromptInput(value);
  return resolved ? [resolved] : [];
}

export function supportsInflectionForNlUPos(partOfSpeech?: string): boolean {
  return partOfSpeech === "NOUN" || partOfSpeech === "VERB" || partOfSpeech === "ADJ";
}
