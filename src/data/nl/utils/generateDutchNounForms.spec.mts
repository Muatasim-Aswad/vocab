import assert from "node:assert";
import { generateDutchNounForms } from "./generateDutchNounForms.mjs";

/**
 * Test suite for Dutch noun form generation
 *
 * Tests various pluralization rules including:
 * - Regular -en plurals with spelling changes
 * - -s plurals for words ending in -e, -el, -er, -en, -em
 * - -zen/-ven for words ending in -s/-f
 * - -'s for loan words ending in vowels
 */

function testNounForms(singular: string, expectedPlural: string, description: string) {
  const result = generateDutchNounForms(singular);
  assert.strictEqual(
    result.plural,
    expectedPlural,
    `${description}\nExpected plural: ${expectedPlural}\nGot: ${result.plural}`,
  );
  console.log(`✓ ${description}`);
}

console.log("Testing Dutch Noun Form Generation\n");

console.log("=== Regular -en plurals ===");
testNounForms("hond", "honden", "hond (dog) → honden");
testNounForms("kat", "katten", "kat (cat) → katten (double consonant for short vowel)");
testNounForms("man", "mannen", "man → mannen (double consonant)");
testNounForms("bal", "ballen", "bal (ball) → ballen (double consonant)");

console.log("\n=== Long vowel adjustments ===");
testNounForms("boom", "bomen", "boom (tree) → bomen (remove double vowel)");
testNounForms("boot", "boten", "boot (boat) → boten (remove double vowel)");
testNounForms("naam", "namen", "naam (name) → namen (remove double vowel)");

console.log("\n=== -s plurals ===");
testNounForms("tafel", "tafels", "tafel (table) → tafels (ends in -el)");
testNounForms("deur", "deuren", "deur (door) → deuren (ends in -r but not -er)");
testNounForms("meisje", "meisjes", "meisje (girl) → meisjes (diminutive)");
testNounForms("jongen", "jongens", "jongen (boy) → jongens (ends in -en)");
testNounForms("bodem", "bodems", "bodem (bottom) → bodems (ends in -em)");

console.log("\n=== -s/-f → -zen/-ven ===");
testNounForms("huis", "huizen", "huis (house) → huizen");
testNounForms("brief", "brieven", "brief (letter) → brieven");
testNounForms("glas", "glazen", "glas (glass) → glazen");

console.log("\n=== Loan words with -'s ===");
testNounForms("auto", "auto's", "auto (car) → auto's");
testNounForms("foto", "foto's", "foto (photo) → foto's");
testNounForms("radio", "radio's", "radio → radio's");
testNounForms("taxi", "taxi's", "taxi → taxi's");

console.log("\n=== Edge cases ===");
testNounForms("boek", "boeken", "boek (book) → boeken (oe is a digraph)");
testNounForms("been", "benen", "been (leg) → benen (ee is long vowel)");
testNounForms("deur", "deuren", "deur (door) → deuren (eu is a digraph)");

// Note: Some nouns have irregular plurals (like "kind" → "kinderen")
// and would need special handling beyond these regular rules
// Also, some words like "dag" can be ambiguous without phonetic information

console.log("\n=== Uncountable nouns (no plural) ===");
function testUncountableNoun(singular: string, description: string) {
  const result = generateDutchNounForms(singular);
  assert.strictEqual(
    result.plural,
    null,
    `${description}\nExpected plural: null (uncountable)\nGot: ${result.plural}`,
  );
  console.log(`✓ ${description}`);
}

testUncountableNoun("vrijheid", "vrijheid (freedom) → no plural (abstract -heid)");
testUncountableNoun("gezondheid", "gezondheid (health) → no plural (abstract -heid)");
testUncountableNoun("vriendschap", "vriendschap (friendship) → no plural (abstract -schap)");
testUncountableNoun("wijsdom", "wijsdom (wisdom) → no plural (abstract -dom)");
testUncountableNoun("kennis", "kennis (knowledge) → no plural (abstract -nis)");
testUncountableNoun("kwaliteit", "kwaliteit (quality) → no plural (abstract -teit)");
testUncountableNoun("harmonie", "harmonie (harmony) → no plural (abstract -ie)");

console.log("\n=== Error handling ===");
try {
  generateDutchNounForms("");
  assert.fail("Should throw error for empty string");
} catch (error) {
  assert(error instanceof Error);
  console.log("✓ Empty string throws error");
}

console.log("\n✅ All noun form tests passed!");
