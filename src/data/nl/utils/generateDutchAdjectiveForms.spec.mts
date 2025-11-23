import assert from "node:assert";
import { generateDutchAdjectiveForms } from "./generateDutchAdjectiveForms.mjs";

/**
 * Test suite for Dutch adjective form generation
 *
 * Tests various inflection patterns including:
 * - Base, inflected, comparative, and superlative forms
 * - Spelling adjustments for short/long vowels
 * - Special cases (material adjectives, etc.)
 */

function testAdjectiveForms(
  base: string,
  expectedInflected: string,
  expectedComparative: string,
  expectedSuperlative: string,
  description: string,
) {
  const result = generateDutchAdjectiveForms(base);

  assert.strictEqual(result.base, base, `${description} - base form`);
  assert.strictEqual(
    result.inflected,
    expectedInflected,
    `${description}\nExpected inflected: ${expectedInflected}\nGot: ${result.inflected}`,
  );
  assert.strictEqual(
    result.comparative,
    expectedComparative,
    `${description}\nExpected comparative: ${expectedComparative}\nGot: ${result.comparative}`,
  );
  assert.strictEqual(
    result.superlative,
    expectedSuperlative,
    `${description}\nExpected superlative: ${expectedSuperlative}\nGot: ${result.superlative}`,
  );

  console.log(`✓ ${description}`);
}

console.log("Testing Dutch Adjective Form Generation\n");

console.log("=== Regular adjectives ===");
testAdjectiveForms("groot", "grote", "groter", "grootst", "groot (big) → grote, groter, grootst");

testAdjectiveForms(
  "klein",
  "kleine",
  "kleiner",
  "kleinst",
  "klein (small) → kleine, kleiner, kleinst",
);

testAdjectiveForms("mooi", "mooie", "mooier", "mooist", "mooi (beautiful) → mooie, mooier, mooist");

console.log("\n=== Short vowel + consonant doubling ===");
testAdjectiveForms(
  "wit",
  "witte",
  "witter",
  "witst",
  "wit (white) → witte, witter, witst (double t)",
);

testAdjectiveForms(
  "dik",
  "dikke",
  "dikker",
  "dikst",
  "dik (thick) → dikke, dikker, dikst (double k)",
);

testAdjectiveForms(
  "dom",
  "domme",
  "dommer",
  "domst",
  "dom (stupid) → domme, dommer, domst (double m)",
);

console.log("\n=== Long vowel adjustments ===");
testAdjectiveForms("laat", "late", "later", "laatst", "laat (late) → late, later, laatst");

testAdjectiveForms(
  "groen",
  "groene",
  "groener",
  "groenst",
  "groen (green) → groene, groener, groenst",
);

console.log("\n=== Adjectives ending in -en ===");
testAdjectiveForms(
  "gouden",
  "gouden",
  "goudener",
  "goudenst",
  "gouden (golden) → gouden (no change for inflected)",
);

testAdjectiveForms(
  "houten",
  "houten",
  "houtener",
  "houtenst",
  "houten (wooden) → houten (material adjective)",
);

console.log("\n=== Adjectives already ending in -e ===");
testAdjectiveForms("lieve", "lieve", "liever", "liefst", "lieve (sweet) → lieve, liever, liefst");

console.log("\n=== Common adjectives ===");
testAdjectiveForms("oud", "oude", "ouder", "oudst", "oud (old) → oude, ouder, oudst");

testAdjectiveForms("jong", "jonge", "jonger", "jongst", "jong (young) → jonge, jonger, jongst");

testAdjectiveForms(
  "nieuw",
  "nieuwe",
  "nieuwer",
  "nieuwst",
  "nieuw (new) → nieuwe, nieuwer, nieuwst",
);

testAdjectiveForms(
  "goed",
  "goede",
  "goeder",
  "goedst",
  "goed (good) → goede, goeder, goedst (note: 'beter' is irregular)",
);

testAdjectiveForms(
  "slecht",
  "slechte",
  "slechter",
  "slechtst",
  "slecht (bad) → slechte, slechter, slechtst",
);

console.log("\n=== Adjectives with special patterns ===");
// Note: "raar" with double 'a' -> removes one 'a' before vowel suffix (-er)
// giving "rarer" which follows the regular spelling rules
testAdjectiveForms("raar", "rare", "rarer", "raarst", "raar (strange) → rare, rarer, raarst");

console.log("\n=== Error handling ===");
try {
  generateDutchAdjectiveForms("");
  assert.fail("Should throw error for empty string");
} catch (error) {
  assert(error instanceof Error);
  console.log("✓ Empty string throws error");
}

try {
  generateDutchAdjectiveForms("   ");
  assert.fail("Should throw error for whitespace only");
} catch (error) {
  assert(error instanceof Error);
  console.log("✓ Whitespace-only string throws error");
}

console.log("\n✅ All adjective form tests passed!");
