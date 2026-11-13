import { BASE_IRREGULAR_VERBS } from "../baseIrregularVerbs.js";
import { COMMON_PLURAL_S_ENDINGS } from "../constants.js";
import type { NlUPos } from "../languageSpec.js";
import {
  bareAdjectiveEnOverrides,
  bareNounPluralOverrides,
  posOverrides,
} from "../lexicalHeuristics.js";
import { checkSeparability } from "./checkSeparability.js";
import { conjugateDutchVerb } from "./conjugateDutchVerbs.js";
import { generateDutchAdjectiveForms } from "./generateDutchAdjectiveForms.js";
import { generateDutchNounForms } from "./generateDutchNounForms.js";

const DIMINUTIVE_SINGULAR_ENDINGS = ["etje", "tje", "pje", "kje", "je"] as const;
const DIMINUTIVE_PLURAL_ENDINGS = ["etjes", "tjes", "pjes", "kjes", "jes"] as const;
const irregularVerbSet = new Set(BASE_IRREGULAR_VERBS);
const NOUN_PLURAL_HINT_SUFFIXES = ["heden", "iteiten", "nissen"] as const;
const VERB_INFINITIVE_HINT_SUFFIXES = ["eren", "elen", "igen", "uren", "varen", "ieren"] as const;

function isLikelyDiminutiveNoun(word: string): boolean {
  return (
    DIMINUTIVE_SINGULAR_ENDINGS.some((ending) => word.endsWith(ending)) ||
    DIMINUTIVE_PLURAL_ENDINGS.some((ending) => word.endsWith(ending))
  );
}

function isLikelyVerbInfinitive(word: string): boolean {
  if (word.endsWith("aan") || word.endsWith("ën")) {
    return true;
  }

  if (!word.endsWith("en")) {
    return false;
  }

  if (bareNounPluralOverrides.has(word) || bareAdjectiveEnOverrides.has(word)) {
    return false;
  }

  if (NOUN_PLURAL_HINT_SUFFIXES.some((suffix) => word.endsWith(suffix))) {
    return false;
  }

  if (irregularVerbSet.has(word)) {
    return true;
  }

  if (checkSeparability(word).isSeparable) {
    return true;
  }

  if (VERB_INFINITIVE_HINT_SUFFIXES.some((suffix) => word.endsWith(suffix))) {
    return true;
  }

  // Avoid short adjective-like -en words such as "open".
  return word.length >= 5;
}

/**
 * Deduce Dutch part of speech based on heuristics only
 * This is the first step - part-of-speech identification without assumptions
 */
function deducePartOfSpeech(word: string): NlUPos | undefined {
  const normalized = word.toLowerCase();
  const override = posOverrides[normalized];
  if (override) {
    return override;
  }

  if (normalized.startsWith("zich ")) {
    return "VERB";
  }

  // * noun - identified by article
  if (normalized.startsWith("de ") || normalized.startsWith("het ")) {
    return "NOUN";
  }

  if (isLikelyDiminutiveNoun(normalized)) {
    return "NOUN";
  }

  if (bareNounPluralOverrides.has(normalized)) {
    return "NOUN";
  }

  if (bareAdjectiveEnOverrides.has(normalized)) {
    return "ADJ";
  }

  // * verb - inferred by infinitive patterns and prefix plausibility
  if (isLikelyVerbInfinitive(normalized)) {
    return "VERB";
  }

  // Default to adjective as it's most common for other patterns
  return "ADJ";
}

/**
 * Deduce tags for a noun based on the word
 */
function deduceNounTags(word: string): string[] {
  const tags: string[] = [];
  const normalized = word.toLowerCase();

  // Remove article if present
  const nounWithoutArticle =
    normalized.startsWith("de ") || normalized.startsWith("het ")
      ? normalized.substring(normalized.indexOf(" ") + 1)
      : normalized;

  // Check for plural indicators
  const isCommonPluralS = COMMON_PLURAL_S_ENDINGS.some(
    (pattern) =>
      nounWithoutArticle === pattern || nounWithoutArticle === pattern.replaceAll("'", ""),
  );
  const isDiminutivePlural = DIMINUTIVE_PLURAL_ENDINGS.some((ending) =>
    nounWithoutArticle.endsWith(ending),
  );

  if (
    nounWithoutArticle.endsWith("en") ||
    nounWithoutArticle.endsWith("ën") ||
    nounWithoutArticle.endsWith("'s") ||
    isDiminutivePlural ||
    isCommonPluralS
  ) {
    tags.push("plural");
  } else {
    tags.push("singular");
  }

  if (isLikelyDiminutiveNoun(nounWithoutArticle)) {
    tags.push("diminutive");
  }

  return tags;
}

/**
 * Deduce tags for a verb based on the word
 */
export function deduceVerbTags(word: string): {
  tags: string[];
  isReflexive: boolean;
  cleanWord: string;
} {
  const tags: string[] = [];
  let normalized = word.toLowerCase();
  let isReflexive = false;

  // Check for reflexive verb
  if (normalized.startsWith("zich ")) {
    tags.push("reflexive");
    isReflexive = true;
    normalized = normalized.split(" ")[1]!;
  }

  return { tags, isReflexive, cleanWord: normalized };
}

/**
 * Check verb separability with detailed information
 */
export function checkVerbSeparability(verb: string): ReturnType<typeof checkSeparability> {
  return checkSeparability(verb);
}

/**
 * Check if verb is irregular based on base verb
 */
export function isVerbIrregular(verb: string, baseVerb?: string): boolean {
  return irregularVerbSet.has(verb) || (baseVerb ? irregularVerbSet.has(baseVerb) : false);
}

/**
 * Generate noun forms with verified input
 */
export function generateVerifiedNounForms(word: string): string[] | undefined {
  try {
    // Remove article if present
    const nounWithoutArticle =
      word.toLowerCase().startsWith("de ") || word.toLowerCase().startsWith("het ")
        ? word.substring(word.indexOf(" ") + 1)
        : word;

    const nounForms = generateDutchNounForms(nounWithoutArticle);
    const forms = [nounForms.plural, nounForms.diminutive, nounForms.diminutivePlural].filter(
      (value): value is string => Boolean(value),
    );
    const unique = [...new Set(forms)];
    return unique.length > 0 ? unique : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Generate verb forms with verified input
 */
export function generateVerifiedVerbForms(
  verb: string,
  isIrregular: boolean,
  separabilityInfo?: ReturnType<typeof checkSeparability>,
): string[] | undefined {
  // Use conjugation with separability and irregularity info
  // The conjugator will handle fetching from dictionary if irregular
  try {
    return conjugateDutchVerb(verb, {
      isSeparable: separabilityInfo?.isSeparable,
      prefix: separabilityInfo?.prefix,
      baseVerb: separabilityInfo?.baseVerb,
      isIrregular,
    });
  } catch {
    return undefined;
  }
}

/**
 * Generate adjective forms with verified input
 */
export function generateVerifiedAdjectiveForms(adjective: string): string[] | undefined {
  try {
    const adjectiveForms = generateDutchAdjectiveForms(adjective);
    return [
      adjectiveForms.base,
      adjectiveForms.inflected,
      adjectiveForms.comparative,
      adjectiveForms.superlative,
    ];
  } catch {
    return undefined;
  }
}

function deduceNounInfo(word: string) {
  const tags = deduceNounTags(word);
  const forms =
    tags.includes("singular") && !tags.includes("plural")
      ? generateVerifiedNounForms(word)
      : undefined;
  return { tags, nounInfo: forms ? { forms } : undefined };
}

function deduceVerbInfo(word: string) {
  const { tags, cleanWord } = deduceVerbTags(word);
  const separability = checkVerbSeparability(cleanWord);
  if (separability.isSeparable) tags.push("separable");

  const irregular = isVerbIrregular(cleanWord, separability.baseVerb);
  const forms = generateVerifiedVerbForms(cleanWord, irregular, separability);
  return { tags, verbInfo: { ...separability, irregular, forms } };
}

/** Deduce Dutch lexical information from the same heuristic rules used for preparation. */
export function deduceDutchWordInfo(input: string) {
  const word = input.toLowerCase();
  const partOfSpeech = deducePartOfSpeech(word);
  const noun = partOfSpeech === "NOUN" ? deduceNounInfo(word) : undefined;
  const verb = partOfSpeech === "VERB" ? deduceVerbInfo(word) : undefined;
  const adjectiveForms = partOfSpeech === "ADJ" ? generateVerifiedAdjectiveForms(word) : undefined;
  const tags = noun?.tags ?? verb?.tags;

  return {
    partOfSpeech,
    tags: tags?.length ? tags : undefined,
    verbInfo: verb?.verbInfo,
    nounInfo: noun?.nounInfo,
    adjectiveInfo: adjectiveForms ? { forms: adjectiveForms } : undefined,
  };
}
