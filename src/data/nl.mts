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

export const SEPARABLE_PREFIXES = [
  "af",
  "aan",
  "mee",
  "uit",
  "op",
  "in",
  "weg",
  "voor",
  "na",
  "toe",
  "bij",
  "door",
];

const INSEPARABLE_PREFIXES = ["be", "ge", "her", "er", "ver", "ont"];

/**
 * Deduce Dutch word form based on heuristics
 * (*) means less certain
 */
export function deduceDutchWordInfo(word: string) {
  word = word.toLowerCase();

  let form: keyof typeof wordTypes | undefined = undefined;
  let types: string[] | undefined = [];

  // * noun
  if (word.startsWith("de ") || word.startsWith("het ")) {
    form = "noun";

    // * plural or singular (*)
    types.push(
      word.endsWith("en") || word.endsWith("ën") || word.endsWith("’s") || word.endsWith("s")
        ? "plural"
        : "singular",
    );
    // * verb
  } else if (word.endsWith("en") || word.endsWith("aan") || word.endsWith("ën")) {
    form = "verb";
    // * reflexive verb
    if (word.startsWith("zich ")) types.push("reflexive");
    // * separable verb
    const isSeparable = SEPARABLE_PREFIXES.some((prefix) => word.startsWith(prefix));
    if (isSeparable) types.push("separable");
  }

  if (types && types.length === 0) types = undefined;
  return { form, types };
}
