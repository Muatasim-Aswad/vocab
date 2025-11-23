/**
 * Generate default Dutch adjective forms
 *
 * Dutch adjectives have several forms:
 * 1. Base form (predicative): Het huis is groot
 * 2. Inflected form (attributive before common/plural nouns): De grote man, de grote huizen
 * 3. Uninflected (attributive before neuter singular nouns): Het grote huis
 * 4. Comparative: groter
 * 5. Superlative: grootst(e)
 *
 * Inflection rules:
 * - Add -e for attributive use (de/het + adjective + noun)
 * - Exception: adjectives ending in -en don't change
 * - Material adjectives (gouden, houten) already end in -en
 */

import { VOWELS } from "../constants.mjs";

export interface DutchAdjectiveForms {
  base: string;
  inflected: string;
  comparative: string;
  superlative: string;
}

export function generateDutchAdjectiveForms(base: string): DutchAdjectiveForms {
  if (!base || base.trim().length === 0) {
    throw new Error("Input must be a non-empty string");
  }

  const adjective = base.toLowerCase().trim();

  // Generate inflected form (add -e)
  const inflected = getInflectedForm(adjective);

  // Generate comparative (add -er)
  const comparative = getComparativeForm(adjective);

  // Generate superlative (add -st(e))
  const superlative = getSuperlativeForm(adjective);

  return {
    base: base.trim(),
    inflected,
    comparative,
    superlative,
  };
}

/**
 * Get inflected form (attributive)
 * Rules:
 * - Most adjectives add -e: groot → grote
 * - Material adjectives ending in -en stay the same: gouden → gouden, houten → houten
 * - But regular adjectives ending in -en still add -e: groen → groene
 * - Spelling adjustments for double vowels/consonants
 */
function getInflectedForm(adjective: string): string {
  // Material adjectives (ending in -en with consonant before): gouden, houten, zilveren
  // Pattern: consonant + -en (not vowel + -en like "groen")
  if (
    adjective.endsWith("en") &&
    adjective.length >= 3 &&
    !VOWELS.includes(adjective[adjective.length - 3])
  ) {
    return adjective;
  }

  // Already ends in -e (but not -ee)
  if (adjective.endsWith("e") && !adjective.endsWith("ee")) {
    return adjective;
  }

  return applySpellingRulesForSuffix(adjective, "e");
}

/**
 * Get comparative form (add -er)
 * Rules:
 * - Add -er: groot → groter
 * - Spelling adjustments apply
 * - No devoicing before -er (vowel suffix)
 */
function getComparativeForm(adjective: string): string {
  // Remove -e if present (base form might already have it)
  let base = adjective;
  if (adjective.endsWith("e") && !adjective.endsWith("ee")) {
    base = adjective.slice(0, -1);
    // Don't apply devoicing before vowel suffix
  }

  return applySpellingRulesForSuffix(base, "er");
}

/**
 * Get superlative form (add -st or -ste)
 * Rules:
 * - Add -st: groot → grootst
 * - Apply devoicing before -st: liev → lief + st
 * - Typically use -ste in attributive position: de grootste
 */
function getSuperlativeForm(adjective: string): string {
  // Remove -e if present
  let base = adjective;
  if (adjective.endsWith("e") && !adjective.endsWith("ee")) {
    base = adjective.slice(0, -1);
    // Apply devoicing before consonant suffix: v → f, z → s
    base = applyDevoicing(base);
  }

  // Add -st (or -ste for attributive, but we'll use -st as base)
  return applySpellingRulesForSuffix(base, "st");
}

/**
 * Apply Dutch devoicing rules
 * v → f and z → s in final position (when not followed by a vowel)
 */
function applyDevoicing(word: string): string {
  if (word.length === 0) return word;

  const lastChar = word[word.length - 1];

  if (lastChar === "v") {
    return word.slice(0, -1) + "f";
  } else if (lastChar === "z") {
    return word.slice(0, -1) + "s";
  }

  return word;
}

/**
 * Apply spelling rules when adding a suffix
 * Similar to noun pluralization rules
 */
function applySpellingRulesForSuffix(word: string, suffix: string): string {
  if (word.length < 2) return word + suffix;

  const lastChar = word[word.length - 1];
  const secondLastChar = word[word.length - 2];
  const suffixStartsWithVowel = VOWELS.includes(suffix[0]);

  // Don't apply spelling rules if word ends in -en (material adjectives, etc.)
  // Just add the suffix directly: gouden + er = goudener
  if (word.endsWith("en") && word.length >= 3 && !VOWELS.includes(word[word.length - 3])) {
    return word + suffix;
  }

  // Rule B: Long vowel with double letter → remove one before VOWEL suffix
  // Example: groot → grote, groter (with -e or -er) but groot → grootst (with -st)
  // The double vowel is only reduced when the suffix starts with a vowel
  if (
    word.length >= 3 &&
    !VOWELS.includes(lastChar) && // ends in consonant
    VOWELS.includes(secondLastChar) && // penultimate is vowel
    VOWELS.includes(word[word.length - 3]) && // antepenultimate is vowel
    secondLastChar === word[word.length - 3] && // same vowel (double)
    suffixStartsWithVowel // only reduce if suffix starts with vowel
  ) {
    // Remove one of the double vowels: groot → grot + e/er
    return word.slice(0, -2) + lastChar + suffix;
  }

  // Rule A: Short vowel + single consonant → double consonant before VOWEL suffix
  // Example: wit → witte, witter (with -e or -er) but wit → witst (with -st)
  // Only double when suffix starts with a vowel
  if (
    !VOWELS.includes(lastChar) && // ends in consonant
    VOWELS.includes(secondLastChar) && // preceded by vowel
    word.length >= 2 &&
    !isLongVowel(word) &&
    suffixStartsWithVowel // only double if suffix starts with vowel
  ) {
    return word + lastChar + suffix;
  }

  return word + suffix;
}

/**
 * Check if a word has a long vowel sound
 */
function isLongVowel(word: string): boolean {
  if (word.length < 3) return false;

  const lastChar = word[word.length - 1];
  const secondLastChar = word[word.length - 2];
  const thirdLastChar = word[word.length - 3];

  // Check for double vowels (long)
  if (VOWELS.includes(secondLastChar) && secondLastChar === thirdLastChar) {
    return true;
  }

  // Check for common digraphs
  const digraphs = ["aa", "ee", "oo", "uu", "ie", "eu", "ou", "au", "ei", "ij", "ui", "oe"];
  const lastTwoVowels = thirdLastChar + secondLastChar;

  return digraphs.includes(lastTwoVowels);
}
