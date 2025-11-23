import { BASE_IRREGULAR_VERBS, BASE_IRREGULAR_VERBS_VALUES } from "../baseIrregularVerbs.mjs";
import { COMMON_PLURAL_S_ENDINGS } from "../constants.mjs";
import { checkSeparability } from "./checkSeparability.mjs";
import { conjugateDutchVerb } from "./conjugateDutchVerbs.mjs";
import { generateDutchNounForms } from "./generateDutchNounForms.mjs";
import { generateDutchAdjectiveForms } from "./generateDutchAdjectiveForms.mjs";

export const wordTypes = {
  noun: {
    nl: "zelfstandig naamwoord",
    code: "znw",
    features: {
      // Better to use 'features' for grammatical characteristics
      number: ["enkelvoud", "meervoud"],
      gender: ["mannelijk", "vrouwelijk", "onzijdig"], // Or ["gemeenschappelijk", "onzijdig"]
    },
  },
  adjective: {
    nl: "bijvoeglijk naamwoord",
    code: "bn",
    features: {
      inflection: ["onverbogen", "verbogen"], // Uninflected, Inflected
      comparison: ["stellende trap", "vergrotende trap", "overtreffende trap"], // Positive, Comparative, Superlative
    },
  },
  verb: {
    nl: "werkwoord",
    code: "ww",
    features: {
      verb_type: ["hoofdwerkwoord", "hulpwerkwoord", "koppelwerkwoord"], // Main, Auxiliary, Linking
      tense: [
        "Onvoltooid Tegenwoordige Tijd",
        "Voltooid Tegenwoordige Tijd",
        "Onvoltooid Verleden Tijd",
        "Voltooid Verleden Tijd",
      ], // Present Simple, Present Perfect, Past Simple, Past Perfect
      mood: ["aantonende wijs", "gebiedende wijs", "aanvoegende wijs"],
      voice: ["bedrijvende vorm", "lijdende vorm"], // Active / Passive
      forms: ["infinitief", "tegenwoordig deelwoord", "voltooid deelwoord"], // Infinitive, Present Participle, Past Participle
    },
  },
  pronoun: {
    nl: "voornaamwoord",
    code: "vnw",
  },
  determiner: {
    nl: "lidwoord", // Specifically for articles: de, het, een
    code: "lw",
  },
  adverb: {
    nl: "bijwoord",
    code: "bw",
  },
  preposition: {
    nl: "voorzetsel",
    code: "vz",
  },
  conjunction: {
    nl: "voegwoord",
    code: "vgw",
  },
  interjection: {
    nl: "tussenwerpsel",
    code: "tw",
  },
};

export const specialTypes = [
  "reflexive",
  "separable",
  "singular",
  "plural",
  "diminutive",
  "comparative",
  "superlative",
  "inflected",
];

/**
 * Deduce Dutch word form based on heuristics only
 * This is the first step - form identification without assumptions
 */
export function deduceWordForm(word: string): keyof typeof wordTypes | undefined {
  const normalized = word.toLowerCase();

  // * noun - identified by article
  if (normalized.startsWith("de ") || normalized.startsWith("het ")) {
    return "noun";
  }

  // * verb - identified by infinitive endings
  if (normalized.endsWith("en") || normalized.endsWith("aan") || normalized.endsWith("ën")) {
    return "verb";
  }

  // Default to adjective as it's most common for other patterns
  return "adjective";
}

/**
 * Deduce types for a noun based on the word
 */
export function deduceNounTypes(word: string): string[] {
  const types: string[] = [];
  const normalized = word.toLowerCase();

  // Remove article if present
  const nounWithoutArticle =
    normalized.startsWith("de ") || normalized.startsWith("het ")
      ? normalized.substring(normalized.indexOf(" ") + 1)
      : normalized;

  // Check for plural indicators
  const isCommonPluralS = COMMON_PLURAL_S_ENDINGS.some(
    (pattern) => nounWithoutArticle === pattern || nounWithoutArticle === pattern.replace("'", ""),
  );

  if (
    nounWithoutArticle.endsWith("en") ||
    nounWithoutArticle.endsWith("ën") ||
    nounWithoutArticle.endsWith("'s") ||
    isCommonPluralS
  ) {
    types.push("plural");
  } else {
    types.push("singular");
  }

  return types;
}

/**
 * Deduce types for a verb based on the word
 */
export function deduceVerbTypes(word: string): {
  types: string[];
  isReflexive: boolean;
  cleanWord: string;
} {
  const types: string[] = [];
  let normalized = word.toLowerCase();
  let isReflexive = false;

  // Check for reflexive verb
  if (normalized.startsWith("zich ")) {
    types.push("reflexive");
    isReflexive = true;
    normalized = normalized.split(" ")[1];
  }

  return { types, isReflexive, cleanWord: normalized };
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
  return (
    BASE_IRREGULAR_VERBS.includes(verb) ||
    (baseVerb ? BASE_IRREGULAR_VERBS.includes(baseVerb) : false)
  );
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
    // Only include plural if it exists (not null for uncountable nouns)
    return nounForms.plural ? [nounForms.singular, nounForms.plural] : [nounForms.singular];
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    return undefined;
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use the new step-by-step functions instead
 */
export function deduceDutchWordInfo(word: string) {
  word = word.toLowerCase();

  let form: keyof typeof wordTypes | undefined = undefined;
  let types: string[] | undefined = [];
  let verbInfo:
    | (ReturnType<typeof checkSeparability> & {
        irregular?: boolean;
        forms?: string[];
      })
    | undefined = undefined;
  let nounInfo: { forms?: string[] } | undefined = undefined;
  let adjectiveInfo: { forms?: string[] } | undefined = undefined;

  form = deduceWordForm(word);

  if (form === "noun") {
    types = deduceNounTypes(word);
    // Only generate forms for singular nouns (not for plural nouns that end in -en, etc.)
    if (types.includes("singular") && !types.includes("plural")) {
      const forms = generateVerifiedNounForms(word);
      if (forms) {
        nounInfo = { forms };
      }
    }
  } else if (form === "verb") {
    const verbTypeInfo = deduceVerbTypes(word);
    types = verbTypeInfo.types;
    const cleanWord = verbTypeInfo.cleanWord;

    const separabilityInfo = checkVerbSeparability(cleanWord);
    if (separabilityInfo.isSeparable) {
      types.push("separable");
    }

    verbInfo = { ...separabilityInfo };
    verbInfo.irregular = isVerbIrregular(cleanWord, separabilityInfo.baseVerb);

    if (!verbInfo.irregular) {
      verbInfo.forms = generateVerifiedVerbForms(cleanWord, false, separabilityInfo);
    }
  } else if (form === "adjective") {
    const forms = generateVerifiedAdjectiveForms(word);
    if (forms) {
      adjectiveInfo = { forms };
    }
  }

  if (types && types.length === 0) types = undefined;
  return { form, types, verbInfo, nounInfo, adjectiveInfo };
}
