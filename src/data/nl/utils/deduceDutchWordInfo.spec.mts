import assert from "node:assert";
import { deduceDutchWordInfo, wordTypes, specialTypes } from "./deduceDutchWordInfo.mjs";

/**
 * Test suite for deduceDutchWordInfo function
 *
 * This function uses heuristics to deduce word types in Dutch.
 * Some cases are inherently ambiguous and may produce incorrect results.
 */

// Test helper
function testWordInfo(
  word: string,
  expected: ReturnType<typeof deduceDutchWordInfo>,
  description: string,
  isKnownLimitation = false,
) {
  const result = deduceDutchWordInfo(word);
  assert.deepStrictEqual(
    result,
    expected,
    `${description}\nExpected: ${JSON.stringify(expected, null, 2)}\nGot: ${JSON.stringify(
      result,
      null,
      2,
    )}`,
  );
  const symbol = isKnownLimitation ? "⚠" : "✓";
  console.log(`${symbol} ${description}`);
}

console.log("Testing Dutch Word Info Deduction\n");

console.log("=== NOUNS (with articles) ===");

testWordInfo(
  "de hond",
  {
    form: "noun",
    types: ["singular"],
    verbInfo: undefined,
    nounInfo: { forms: ["hond", "honden"] },
    adjectiveInfo: undefined,
  },
  "de hond - singular noun with 'de' article",
);

testWordInfo(
  "het huis",
  {
    form: "noun",
    types: ["singular"],
    verbInfo: undefined,
    nounInfo: { forms: ["huis", "huizen"] },
    adjectiveInfo: undefined,
  },
  "het huis - singular noun with 'het' article",
);

testWordInfo(
  "de huizen",
  {
    form: "noun",
    types: ["plural"],
    verbInfo: undefined,
    nounInfo: { forms: ["huizen", "huizens"] },
    adjectiveInfo: undefined,
  },
  "de huizen - plural noun ending in '-en'",
);

testWordInfo(
  "de auto's",
  {
    form: "noun",
    types: ["plural"],
    verbInfo: undefined,
    nounInfo: { forms: ["auto's", "auto'zen"] },
    adjectiveInfo: undefined,
  },
  "de auto's - plural noun ending in '-'s'",
);

testWordInfo(
  "de kinderen",
  {
    form: "noun",
    types: ["plural"],
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "de kinderen - plural noun ending in '-en'",
);

testWordInfo(
  "het boek",
  {
    form: "noun",
    types: ["singular"],
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "het boek - singular noun (no plural ending)",
);

testWordInfo(
  "de hond",
  {
    form: "noun",
    types: ["singular"],
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "de hond - singular noun ending in consonant",
);

testWordInfo(
  "de autos",
  {
    form: "noun",
    types: ["plural"],
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "de autos - plural ending in plain '-s' (loan word, detected via dictionary)",
);

console.log("\n=== VERBS (regular) ===");

testWordInfo(
  "maken",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "maken",
      confidence: "Base Verb",
      irregular: false,
      forms: ["maak", "maakt", "maken", "maakte", "maakten", "gemaakt"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "maken - regular base verb",
);

testWordInfo(
  "werken",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "werken",
      confidence: "Base Verb",
      irregular: false,
      forms: ["werk", "werkt", "werken", "werkte", "werkten", "gewerkt"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "werken - regular base verb",
);

testWordInfo(
  "horen",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "horen",
      confidence: "Base Verb",
      irregular: false,
      forms: ["hoor", "hoort", "horen", "hoorde", "hoorden", "gehoord"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "horen - regular base verb with -d ending",
);

console.log("\n=== VERBS (irregular) ===");

testWordInfo(
  "lopen",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "lopen",
      confidence: "Base Verb",
      irregular: true,
      // forms not generated for irregular verbs
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "lopen - irregular verb (no forms generated)",
);

testWordInfo(
  "hebben",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "hebben",
      confidence: "Base Verb",
      irregular: true,
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "hebben - irregular auxiliary verb",
);

testWordInfo(
  "gaan",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "gaan",
      confidence: "Base Verb",
      irregular: true,
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "gaan - irregular verb",
);

console.log("\n=== VERBS (separable) ===");

testWordInfo(
  "aankomen",
  {
    form: "verb",
    types: ["separable"],
    verbInfo: {
      isSeparable: true,
      prefix: "aan",
      baseVerb: "komen",
      confidence: "High",
      irregular: true, // 'komen' is irregular
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "aankomen - separable verb with irregular base",
);

testWordInfo(
  "ophalen",
  {
    form: "verb",
    types: ["separable"],
    verbInfo: {
      isSeparable: true,
      prefix: "op",
      baseVerb: "halen",
      confidence: "High",
      irregular: false,
      forms: ["haal", "haalt", "halen", "haalde", "haalden", "gehaald"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "ophalen - separable verb with regular base",
);

testWordInfo(
  "uitgaan",
  {
    form: "verb",
    types: ["separable"],
    verbInfo: {
      isSeparable: true,
      prefix: "uit",
      baseVerb: "gaan",
      confidence: "High",
      irregular: true, // 'gaan' is irregular
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "uitgaan - separable verb with irregular base",
);

console.log("\n=== VERBS (reflexive) ===");

testWordInfo(
  "zich vergissen",
  {
    form: "verb",
    types: ["reflexive"],
    verbInfo: {
      isSeparable: false,
      prefix: "ver",
      baseVerb: "gissen",
      confidence: "High",
      irregular: false,
      forms: ["gis", "gist", "gissen", "giste", "gisten", "gegist"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "zich vergissen - reflexive verb",
);

testWordInfo(
  "zich herinneren",
  {
    form: "verb",
    types: ["reflexive"],
    verbInfo: {
      isSeparable: false,
      prefix: "her",
      baseVerb: "inneren",
      confidence: "High",
      irregular: false,
      forms: ["inneer", "inneert", "inneren", "inneerde", "inneerden", "geinneerd"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "zich herinneren - reflexive verb with inseparable prefix",
  true, // Note: actual verb is irregular, conjugation here is hypothetical regular form
);

console.log("\n=== VERBS (with inseparable prefixes) ===");

testWordInfo(
  "betalen",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: "be",
      baseVerb: "talen",
      confidence: "High",
      irregular: false,
      forms: ["taal", "taalt", "talen", "taalde", "taalden", "getaald"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "betalen - verb with inseparable prefix 'be-' (forms are for base verb 'talen')",
  true, // Note: forms are for base verb only, not full verb with prefix
);

testWordInfo(
  "vergeten",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: "ver",
      baseVerb: "geten",
      confidence: "High",
      irregular: true, // 'vergeten' is in irregular list
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "vergeten - irregular verb with inseparable prefix",
);

console.log("\n=== VERBS (ending variations) ===");

testWordInfo(
  "opzeggen",
  {
    form: "verb",
    types: ["separable"],
    verbInfo: {
      isSeparable: true,
      prefix: "op",
      baseVerb: "zeggen",
      confidence: "High",
      irregular: true, // 'zeggen' is in irregular list
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "opzeggen - verb with separable prefix and irregular base",
);

testWordInfo(
  "inslaan",
  {
    form: "verb",
    types: ["separable"],
    verbInfo: {
      isSeparable: true,
      prefix: "in",
      baseVerb: "slaan",
      confidence: "High",
      irregular: true, // 'slaan' is irregular
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "inslaan - separable verb ending in '-aan'",
);

console.log("\n=== ADJECTIVES (default fallback) ===");

testWordInfo(
  "groot",
  {
    form: "adjective",
    types: undefined,
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "groot - adjective (default for words not matching other patterns)",
);

testWordInfo(
  "mooi",
  {
    form: "adjective",
    types: undefined,
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "mooi - adjective",
);

testWordInfo(
  "goed",
  {
    form: "adjective",
    types: undefined,
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "goed - adjective",
);

testWordInfo(
  "snel",
  {
    form: "adjective",
    types: undefined,
    verbInfo: undefined,
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "snel - adjective",
);

console.log("\n=== KNOWN LIMITATIONS (ambiguous cases) ===");

testWordInfo(
  "doen",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "doen",
      confidence: "Base Verb",
      irregular: true,
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "doen - irregular verb (short form)",
  true, // Ends in 'en' so detected as verb (correct)
);

testWordInfo(
  "leven",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "leven",
      confidence: "Base Verb",
      irregular: false,
      forms: ["leef", "leeft", "leven", "leefte", "leeften", "geleeft"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "leven - can be verb or noun, detected as verb (ends in '-en')",
  true, // Ambiguous: could be noun "het leven" without article
);

testWordInfo(
  "open",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "open",
      confidence: "Base Verb",
      irregular: false,
      forms: ["oop", "oopt", "open", "oopte", "oopten", "geoopt"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "open - adjective incorrectly detected as verb (ends in '-en')",
  true, // Known limitation: words ending in -en without article are assumed to be verbs
);

testWordInfo(
  "eten",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "eten",
      confidence: "Base Verb",
      irregular: true,
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "eten - can be verb or noun, detected as verb (ends in '-en')",
  true, // Ambiguous: "het eten" (noun) vs "eten" (verb)
);

testWordInfo(
  "kinderen",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "kinderen",
      confidence: "Base Verb",
      irregular: false,
      forms: ["kindeer", "kindeert", "kinderen", "kindeerde", "kindeerden", "gekindeerd"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "kinderen - plural noun incorrectly detected as verb (ends in '-en')",
  true, // Known limitation: without article, plural nouns look like verbs
);

testWordInfo(
  "boeken",
  {
    form: "verb",
    types: undefined,
    verbInfo: {
      isSeparable: false,
      prefix: null,
      baseVerb: "boeken",
      confidence: "Base Verb",
      irregular: false,
      forms: ["boek", "boekt", "boeken", "boekte", "boekten", "geboekt"],
    },
    nounInfo: undefined,
    adjectiveInfo: undefined,
  },
  "boeken - can be verb (to book) or plural noun (books), detected as verb",
  true, // Ambiguous: context needed
);

console.log("\n✅ All tests passed!");
console.log("⚠ = Known limitation (heuristic-based, may require context or article)");
