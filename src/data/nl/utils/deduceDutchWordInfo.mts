import { BASE_IRREGULAR_VERBS } from "../baseIrregularVerbs.mjs";
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
 * Deduce Dutch word form based on heuristics
 * (*) means less certain
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

  // * noun
  if (word.startsWith("de ") || word.startsWith("het ")) {
    form = "noun";

    // * plural or singular (*)
    // Note: This is heuristic-based and may not be 100% accurate
    // Plural indicators: -en, -ën, -'s, and common plural -s patterns (loan words)
    const nounWithoutArticle = word.substring(word.indexOf(" ") + 1);
    const isCommonPluralS = COMMON_PLURAL_S_ENDINGS.some(
      (pattern) =>
        nounWithoutArticle === pattern || nounWithoutArticle === pattern.replace("'", ""),
    );

    types.push(
      word.endsWith("en") || word.endsWith("ën") || word.endsWith("'s") || isCommonPluralS
        ? "plural"
        : "singular",
    );

    // Generate noun forms (singular and plural)
    try {
      const nounForms = generateDutchNounForms(nounWithoutArticle);
      // Only include plural if it exists (not null for uncountable nouns)
      nounInfo = {
        forms: nounForms.plural ? [nounForms.singular, nounForms.plural] : [nounForms.singular], // Uncountable nouns have only singular form
      };
    } catch (error) {
      // If generation fails, leave nounInfo undefined
      nounInfo = undefined;
    }
    // * verb
  } else if (word.endsWith("en") || word.endsWith("aan") || word.endsWith("ën")) {
    form = "verb";
    // * reflexive verb
    if (word.startsWith("zich ")) {
      types.push("reflexive");
      word = word.split(" ")[1];
    }
    // * separable verb
    const result = checkSeparability(word);
    if (result.isSeparable) types.push("separable");
    verbInfo = { ...result };
    // * irregular verb
    // Check if either the full verb or the base verb is irregular
    verbInfo.irregular =
      BASE_IRREGULAR_VERBS.includes(word) || BASE_IRREGULAR_VERBS.includes(result.baseVerb);
    // * if regular get the verb forms
    if (!verbInfo.irregular) verbInfo.forms = conjugateDutchVerb(word);
  } else {
    // resort to adjective as default as it's more common than others
    form = "adjective";

    // Generate adjective forms (base, inflected, comparative, superlative)
    try {
      const adjectiveForms = generateDutchAdjectiveForms(word);
      adjectiveInfo = {
        forms: [
          adjectiveForms.base,
          adjectiveForms.inflected,
          adjectiveForms.comparative,
          adjectiveForms.superlative,
        ],
      };
    } catch (error) {
      // If generation fails, leave adjectiveInfo undefined
      adjectiveInfo = undefined;
    }
  }

  if (types && types.length === 0) types = undefined;
  return { form, types, verbInfo, nounInfo, adjectiveInfo };
}
