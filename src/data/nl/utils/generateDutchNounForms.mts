/**
 * Generate default Dutch noun forms (singular and plural)
 *
 * Dutch noun pluralization follows several rules:
 * 1. Most nouns add -en: hond → honden
 * 2. Nouns ending in unstressed -e, -el, -em, -en, -er add -s: tafel → tafels
 * 3. Nouns ending in -s, -f become -zen, -ven + en: huis → huizen, brief → brieven
 * 4. Some loan words add -'s: auto → auto's
 * 5. Spelling changes for long/short vowels (similar to verb rules)
 *
 * Uncountable nouns (return null for plural):
 * - Abstract concepts ending in -heid: vrijheid, gezondheid, waarheid
 * - Abstract concepts ending in -schap: vriendschap, wetenschap
 * - Abstract states ending in -dom: wijsdom, rijkdom
 * - Abstract qualities ending in -teit: kwaliteit, kwantiteit
 * - Abstract concepts ending in -nis: kennis, begrafenis
 * - Process nouns ending in -ing: verwarring, opleiding (context-dependent)
 * - Many nouns ending in -ie: harmonie, democratie (context-dependent)
 */

import { VOWELS, DIGRAPHS } from "../constants.mjs";

export interface DutchNounForms {
  plural: string | null; // null for uncountable nouns
}

export function generateDutchNounForms(singular: string): DutchNounForms {
  if (!singular || singular.trim().length === 0) {
    throw new Error("Input must be a non-empty string");
  }

  const word = singular.toLowerCase().trim();

  // Check for uncountable nouns (abstract concepts, mass nouns)
  // These nouns typically don't have plural forms
  const uncountableEndings = [
    "heid", // vrijheid, waarheid, gezondheid (abstract qualities)
    "schap", // vriendschap, wetenschap (abstract concepts)
    "dom", // wijsdom, rijkdom (abstract states)
    "te", // hoogte, diepte, lengte (when used as abstract measurements)
    "nis", // kennis, begrafenis (abstract or singular events)
    "ing", // verwarring, opleiding (when referring to the process)
    "teit", // kwaliteit, kwantiteit (abstract qualities)
    "ie", // harmonie, democratie (many -ie ending abstracts)
  ];

  const isUncountable = uncountableEndings.some(
    (ending) => word.endsWith(ending) && word.length > ending.length,
  );

  if (isUncountable) {
    return {
      plural: null, // No plural form for uncountable nouns
    };
  }

  let plural = word;

  // Rule 1: Words ending in -s, -f change to -zen, -ven before adding -en
  if (word.endsWith("s") && !word.endsWith("ies") && !word.endsWith("eus")) {
    plural = word.slice(0, -1) + "zen";
  } else if (word.endsWith("f")) {
    plural = word.slice(0, -1) + "ven";
  }
  // Rule 2: Words ending in unstressed -e, -el, -em, -en, -er add -s
  // Note: -en ending typically means the word already has a plural-like ending
  // (like jongen, keuken) or is a verb infinitive form used as noun
  else if (
    word.endsWith("e") ||
    word.endsWith("el") ||
    word.endsWith("em") ||
    (word.endsWith("en") && word.length > 3 && !VOWELS.includes(word[word.length - 3])) || // -Cen pattern (consonant + en)
    word.endsWith("er") ||
    word.endsWith("je") // diminutives
  ) {
    plural = word + "s";
  }
  // Rule 3: Loan words ending in vowels (except -e) typically add -'s
  else if (
    word.endsWith("a") ||
    word.endsWith("i") ||
    word.endsWith("o") ||
    word.endsWith("u") ||
    word.endsWith("y")
  ) {
    plural = word + "'s";
  }
  // Rule 4: Default case - add -en with spelling adjustments
  else {
    plural = applySpellingRules(word) + "en";
  }

  return {
    plural,
  };
}

/**
 * Apply Dutch spelling rules when adding -en suffix
 * Similar to verb conjugation rules but in reverse (adding suffix instead of removing)
 */
function applySpellingRules(word: string): string {
  if (word.length < 2) return word;

  let result = word;
  const lastChar = result[result.length - 1];
  const secondLastChar = result[result.length - 2];

  if (result.length < 3) {
    return result;
  }

  const thirdLastChar = result[result.length - 3];

  // Rule 1: Long vowel spelled with double letter → remove one FIRST
  // Example: boom → bomen, boot → boten, naam → namen
  // Pattern: consonant-vowel-vowel-consonant where the two vowels are the same
  if (
    !VOWELS.includes(lastChar) && // ends in consonant
    VOWELS.includes(secondLastChar) && // penultimate is vowel
    VOWELS.includes(thirdLastChar) && // antepenultimate is vowel
    secondLastChar === thirdLastChar // same vowel (double)
  ) {
    // Remove one of the double vowels: boom → bom, then add -en later
    // Remove character at position length-2 (one of the double vowels)
    result = result.slice(0, -2) + lastChar;
    return result;
  }

  // Rule 2: Short vowel followed by single consonant → double the consonant
  // Example: bal → ballen, man → mannen
  if (
    !VOWELS.includes(lastChar) && // ends in consonant
    VOWELS.includes(secondLastChar) && // preceded by vowel
    !VOWELS.includes(thirdLastChar) // not a double vowel
  ) {
    // Check if it's a digraph (long vowel combination)
    const possibleDigraph = thirdLastChar + secondLastChar;
    const isDigraph = DIGRAPHS.includes(possibleDigraph);

    // If single short vowel, double the consonant
    if (!isDigraph) {
      result = result + lastChar;
    }
  }

  return result;
}
