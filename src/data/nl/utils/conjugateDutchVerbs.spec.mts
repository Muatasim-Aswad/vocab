import assert from "node:assert";
import { conjugateDutchVerb } from "./conjugateDutchVerbs.mjs";

/**
 * Test suite for Dutch verb conjugation function
 *
 * This function handles REGULAR verb conjugations only. Irregular verbs are defined
 * in baseIrregularVerbs.mts and handled separately.
 *
 * The function receives base verbs (not prefixed with separable prefixes) and applies
 * standard Dutch spelling rules for regular conjugation patterns.
 */

// Test helper to compare conjugation results
function testConjugation(infinitive: string, expected: string[], description: string) {
  const result = conjugateDutchVerb(infinitive);
  assert.deepStrictEqual(
    result,
    expected,
    `${description}\nExpected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(result)}`,
  );
  console.log(`✓ ${description}`);
}

console.log("Testing Dutch Verb Conjugation\n");

// Test 1: Basic regular verb with 't kofschip rule (weak ending)
testConjugation(
  "maken",
  ["maak", "maakt", "maakte", "maakten", "gemaakt"],
  "maken (to make) - 't kofschip verb with long vowel",
);

// Test 2: Regular verb with -d ending (strong ending)
testConjugation(
  "horen",
  ["hoor", "hoort", "hoorde", "hoorden", "gehoord"],
  "horen (to hear) - regular verb with -d ending",
);

// Test 3: Double consonant verbs (short vowel - should NOT double the vowel)
testConjugation(
  "pakken",
  ["pak", "pakt", "pakte", "pakten", "gepakt"],
  "pakken (to grab) - double consonant indicates short vowel",
);

testConjugation(
  "bellen",
  ["bel", "belt", "belde", "belden", "beld"],
  "bellen (to call) - double consonant with -d ending (no ge- due to 'be-' prefix)",
);

testConjugation(
  "melden",
  ["meld", "meldt", "meldde", "meldden", "gemeld"],
  "melden (to report) - double consonant with -d ending, avoids double 'd' in past participle",
);

// Test 4: Devoicing (v → f, z → s)
testConjugation(
  "leven",
  ["leef", "leeft", "leefde", "leefden", "geleefd"],
  "leven (to live) - v becomes f in writing, but past tense uses -d (voiced v)",
);

testConjugation(
  "reizen",
  ["reis", "reist", "reisde", "reisden", "gereisd"],
  "reizen (to travel) - z becomes s in writing, but past tense uses -d (voiced z)",
);

testConjugation(
  "stoven",
  ["stoof", "stooft", "stoofde", "stoofden", "gestoofd"],
  "stoven (to stew) - v becomes f in writing, but past tense uses -d (voiced v)",
);

// Test 5: Long vowel preservation (note: these tests show regular conjugations, not irregular forms)
testConjugation(
  "lopen",
  ["loop", "loopt", "loopte", "loopten", "geloopt"],
  "lopen (to walk) - long vowel preservation (regular form, not irregular 'liep')",
);

testConjugation(
  "dromen",
  ["droom", "droomt", "droomde", "droomden", "gedroomd"],
  "dromen (to dream) - long vowel preservation",
);

// Test 6: Inseparable prefix (no ge-)
testConjugation(
  "betalen",
  ["betaal", "betaalt", "betaalde", "betaalden", "betaald"],
  "betalen (to pay) - inseparable prefix 'be-'",
);

testConjugation(
  "vergeten",
  ["vergeet", "vergeette", "vergeetten"],
  "vergeten (to forget) - inseparable prefix 'ver-', stem ends in 't' (regular form, not irregular 'vergat')",
);

testConjugation(
  "gebeuren",
  ["gebeur", "gebeurt", "gebeurde", "gebeurden", "gebeurd"],
  "gebeuren (to happen) - inseparable prefix 'ge-', 'eu' digraph preserved",
);

// Test 7: 't kofschip rule - various endings
testConjugation(
  "werken",
  ["werk", "werkt", "werkte", "werkten", "gewerkt"],
  "werken (to work) - ends in 'k'",
);

testConjugation(
  "lachen",
  ["lach", "lacht", "lachte", "lachten", "gelacht"],
  "lachen (to laugh) - ends in 'ch'",
);

testConjugation(
  "stoppen",
  ["stop", "stopt", "stopte", "stopten", "gestopt"],
  "stoppen (to stop) - ends in 'p', double consonant indicates short vowel",
);

// Test 8: Stem already ends in 't'
testConjugation(
  "wachten",
  ["wacht", "wachtte", "wachtten", "gewacht"],
  "wachten (to wait) - stem already ends in 't', past participle avoids double 't'",
);

testConjugation(
  "praten",
  ["praat", "praatte", "praatten", "gepraat"],
  "praten (to talk) - stem ends in 't' with long vowel, past participle avoids double 't'",
);

// Test 9: Verbs with 'ij' digraph (no doubling)
testConjugation(
  "kijken",
  ["kijk", "kijkt", "kijkte", "kijkten", "gekijkt"],
  "kijken (to look) - 'ij' digraph should not change (regular form, not irregular 'keek')",
);

// Test 10: Complex verbs
testConjugation(
  "studeren",
  ["studeer", "studeert", "studeerde", "studeerden", "gestudeerd"],
  "studeren (to study) - complex verb with long vowel",
);

testConjugation(
  "ontmoeten",
  ["ontmoet", "ontmoette", "ontmoetten"],
  "ontmoeten (to meet) - inseparable prefix 'ont-', stem ending in 't', past participle avoids double 't'",
);

// Test 11: Separable verbs with options
console.log("\n=== Separable verbs ===");

// Helper to test separable verbs
function testSeparableConjugation(
  baseVerb: string,
  prefix: string,
  expected: string[],
  description: string,
) {
  const result = conjugateDutchVerb(baseVerb, {
    isSeparable: true,
    prefix: prefix,
    baseVerb: baseVerb,
    isIrregular: false,
  });
  assert.deepStrictEqual(
    result,
    expected,
    `${description}\nExpected: ${JSON.stringify(expected)}\nGot: ${JSON.stringify(result)}`,
  );
  console.log(`✓ ${description}`);
}

testSeparableConjugation(
  "halen",
  "op",
  ["haal", "haalt", "haalde", "haalden", "opgehaald"],
  "ophalen (to pick up) - separable verb with regular base, ge- between prefix and stem",
);

testSeparableConjugation(
  "verwarmen",
  "voor",
  ["verwarm", "verwarmt", "verwarmde", "verwarmden", "voorverwarmd"],
  "voorverwarmen (to preheat) - separable verb with inseparable base 'verwarmen', no ge- added",
);

testSeparableConjugation(
  "bereiden",
  "voor",
  ["bereid", "bereidt", "bereidde", "bereidden", "voorbereid"],
  "voorbereiden (to prepare) - separable verb with inseparable base 'bereiden', no ge- added",
);

// Test 12: Error cases
console.log("\nTesting error cases:");

try {
  conjugateDutchVerb("loop");
  console.log("✗ Should throw error for verb not ending in 'en'");
  process.exit(1);
} catch (error) {
  assert.strictEqual((error as Error).message, "Input must be a Dutch infinitive ending in 'en'");
  console.log("✓ Correctly throws error for verb not ending in 'en'");
}

try {
  conjugateDutchVerb("en");
  console.log("✗ Should throw error for verb too short");
  process.exit(1);
} catch (error) {
  assert.strictEqual((error as Error).message, "Input must be a Dutch infinitive ending in 'en'");
  console.log("✓ Correctly throws error for verb too short");
}

console.log("\n✅ All tests passed!");
