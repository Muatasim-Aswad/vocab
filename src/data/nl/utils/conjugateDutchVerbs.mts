import {
  TKOFSHIP_ENDINGS,
  INSEPARABLE_PREFIXES,
  VOWELS,
  DIGRAPHS,
  SEPARABLE_PREFIXES,
} from "../constants.mjs";
import { BASE_IRREGULAR_VERBS_VALUES } from "../baseIrregularVerbs.mjs";

/**
 * Conjugate a Dutch verb with optional separability and irregularity info
 * @param infinitive - The verb infinitive (e.g., "maken" or "opnemen")
 * @param options - Optional configuration for separable/irregular verbs
 * @returns Array of conjugated forms
 */
export function conjugateDutchVerb(
  infinitive: string,
  options?: {
    isSeparable?: boolean;
    prefix?: string | null;
    baseVerb?: string;
    isIrregular?: boolean;
  },
): string[] {
  if (!infinitive.endsWith("en") || infinitive.length < 3) {
    throw new Error("Input must be a Dutch infinitive ending in 'en'");
  }

  // Determine if we're working with a separable verb
  const isSeparable = options?.isSeparable || false;
  const prefix = options?.prefix || null;
  const baseVerb = options?.baseVerb || infinitive;
  const isIrregular = options?.isIrregular || false;

  // Apply standard Dutch spelling rules to get the correct stem
  const getStem = (infinitive: string): string => {
    // Remove infinitive ending (-en)
    let stem = infinitive.slice(0, -2);

    let lastChar = stem[stem.length - 1];
    let secondLastChar = stem[stem.length - 2];

    // ---------------------------------------------------------
    // Rule A: v → f, z → s   (Dutch devoicing in final position)
    // ---------------------------------------------------------
    if (lastChar === "v") stem = stem.slice(0, -1) + "f";
    else if (lastChar === "z") stem = stem.slice(0, -1) + "s";

    // Recompute after modification
    lastChar = stem[stem.length - 1];
    secondLastChar = stem[stem.length - 2];

    // ---------------------------------------------------------
    // Rule B: Remove double consonant at the end
    // pakken → pakk → pak
    // bellen → bell → bel
    // ---------------------------------------------------------
    let hadDoubleConsonant = false;
    if (stem.length >= 3 && lastChar === secondLastChar && !VOWELS.includes(lastChar)) {
      stem = stem.slice(0, -1);
      hadDoubleConsonant = true; // Track that we had a double consonant (indicates short vowel)
    }

    // Recompute again
    lastChar = stem[stem.length - 1];
    secondLastChar = stem[stem.length - 2];

    // ---------------------------------------------------------
    // Rule C: Long vowel preservation
    // maken → maak
    // lopen → loop
    // dromen → droom
    //
    // If the stem ends in a consonant and the preceding vowel is single,
    // double the vowel *unless already a digraph*.
    // Don't apply if we just removed a double consonant (that indicates short vowel).
    // ---------------------------------------------------------
    if (
      !hadDoubleConsonant && // NEW: Don't double if we removed a double consonant
      stem.length >= 2 &&
      !VOWELS.includes(lastChar) && // ends in consonant
      VOWELS.includes(secondLastChar) // before it is a vowel
    ) {
      const vowel = secondLastChar;
      const thirdLastChar = stem[stem.length - 3];

      // Check if the vowel is part of a digraph
      const possibleDigraph = thirdLastChar + vowel;
      const isDigraph = DIGRAPHS.includes(possibleDigraph) || DIGRAPHS.includes(vowel);

      // If vowel is not already long (not a digraph), double it
      if (!isDigraph && vowel !== "i") {
        stem = stem.slice(0, -1) + vowel + lastChar;
      }
    }

    return stem;
  };

  // Helper function for jij/hij/zij/het form (add -t)
  const getPresentSecondPerson = (stem: string): string => {
    // Don't add -t if stem already ends in -t
    if (stem.endsWith("t")) return stem;
    return stem + "t";
  };

  // Get past tense suffix based on 't kofschip rule
  // IMPORTANT: Check the original stem BEFORE devoicing (v→f, z→s)
  const tORd = (infinitive: string): "t" | "d" => {
    // Get original stem before devoicing
    const originalStem = infinitive.slice(0, -2); // Remove -en
    const lastChar = originalStem[originalStem.length - 1];
    const lastTwoChars = originalStem.slice(-2);

    return TKOFSHIP_ENDINGS.includes(lastChar) || TKOFSHIP_ENDINGS.includes(lastTwoChars)
      ? "t"
      : "d";
  };

  // Get past participle prefix (ge- or not)
  const getPastParticiplePrefix = (
    infinitive: string,
    isSeparable: boolean,
    prefix: string | null,
    baseVerb: string,
  ): string => {
    // If separable, check if the BASE VERB has an inseparable prefix
    if (isSeparable && prefix) {
      // Check if base verb starts with inseparable prefix (e.g., "verwarmen" in "voorverwarmen")
      const baseHasInseparablePrefix = INSEPARABLE_PREFIXES.some((pre) => baseVerb.startsWith(pre));
      if (baseHasInseparablePrefix) {
        // Base verb doesn't get "ge", so separable verb gets: prefix + (no ge) + stem
        // This is handled in the main logic by checking this return value
        return prefix; // Just return prefix, no "ge"
      }
      return prefix + "ge"; // Normal separable: prefix + ge + stem
    }

    // If inseparable prefix, no ge-
    return INSEPARABLE_PREFIXES.some((pre) => infinitive.startsWith(pre)) ? "" : "ge";
  };

  // Get the stem with proper spelling rules applied
  const stemVerb = isSeparable && baseVerb ? baseVerb : infinitive;
  const presentFirstPerson = getStem(stemVerb);
  const presentSecondPerson = getPresentSecondPerson(presentFirstPerson);

  // If irregular, fetch past forms from dictionary
  if (isIrregular) {
    const lookupVerb = baseVerb || infinitive;
    if (lookupVerb in BASE_IRREGULAR_VERBS_VALUES) {
      const irregularForms =
        BASE_IRREGULAR_VERBS_VALUES[lookupVerb as keyof typeof BASE_IRREGULAR_VERBS_VALUES];
      const [pastSingular, pastPlural, pastParticiple] = irregularForms;

      // Check if the full infinitive has an inseparable prefix
      // For irregular verbs with inseparable prefixes: infinitive has the prefix, but baseVerb doesn't
      // Example: infinitive="verbieden", baseVerb="bieden", prefix should be "ver"
      const hasInseparablePrefix =
        !isSeparable &&
        infinitive !== lookupVerb &&
        INSEPARABLE_PREFIXES.some((pre) => infinitive.startsWith(pre));

      const inseparablePrefix = hasInseparablePrefix
        ? INSEPARABLE_PREFIXES.find((pre) => infinitive.startsWith(pre)) || ""
        : "";

      // Build past tense forms with inseparable prefix if needed
      let finalPastSingular = pastSingular;
      let finalPastPlural = pastPlural;
      let finalPastParticiple = pastParticiple || "";

      if (hasInseparablePrefix && inseparablePrefix) {
        // For irregular verbs with inseparable prefixes (e.g., verbieden from bieden)
        // Add the prefix to all past forms: ver + bood = verbood, ver + boden = verboden
        finalPastSingular = inseparablePrefix + pastSingular;
        finalPastPlural = inseparablePrefix + pastPlural;
        // For past participle, the base form already has "ge" (geboden), replace with prefix
        // Remove "ge" from the base irregular form and add the inseparable prefix
        if (pastParticiple) {
          const participleStem = pastParticiple.startsWith("ge")
            ? pastParticiple.slice(2)
            : pastParticiple;
          finalPastParticiple = inseparablePrefix + participleStem;
        }
      } else if (isSeparable && prefix && pastParticiple) {
        // For separable irregular verbs, prepend the prefix (e.g., op + gekomen = opgekomen)
        finalPastParticiple = prefix + pastParticiple;
      }

      // Build forms array for irregular verbs
      const forms = [
        presentFirstPerson,
        presentSecondPerson,
        finalPastSingular,
        finalPastPlural,
        finalPastParticiple,
      ].filter((form): form is string => form !== null && form !== "");

      // Remove duplicates while preserving order
      const seen = new Set<string>();
      const uniqueForms: string[] = [];
      for (const form of forms) {
        if (!seen.has(form)) {
          seen.add(form);
          uniqueForms.push(form);
        }
      }

      return uniqueForms;
    }
  }

  // Regular verb conjugation
  const pastSuffix = tORd(stemVerb);
  const pastParticiplePrefix = getPastParticiplePrefix(infinitive, isSeparable, prefix, baseVerb);

  // Fix Bug 3: Avoid double 't' or 'd' in past participle
  const pastParticipleSuffix =
    (presentFirstPerson.endsWith("t") && pastSuffix === "t") ||
    (presentFirstPerson.endsWith("d") && pastSuffix === "d")
      ? ""
      : pastSuffix;

  // Build past participle correctly for separable verbs
  let pastParticiple: string;
  if (isSeparable && prefix) {
    // For separable verbs: check if we should add "ge"
    const baseHasInseparablePrefix = INSEPARABLE_PREFIXES.some((pre) => baseVerb.startsWith(pre));
    if (baseHasInseparablePrefix) {
      // Base verb like "verwarmen" doesn't get "ge", so: voor + verwarmd
      pastParticiple = prefix + presentFirstPerson + pastParticipleSuffix;
    } else {
      // Normal separable: prefix + ge + stem + suffix (e.g., op + ge + haald = opgehaald)
      pastParticiple = prefix + "ge" + presentFirstPerson + pastParticipleSuffix;
    }
  } else {
    // For regular/inseparable verbs: prefix + stem + suffix
    pastParticiple = pastParticiplePrefix + presentFirstPerson + pastParticipleSuffix;
  }

  // Build the forms array (excluding infinitive)
  const forms = [
    presentFirstPerson,
    presentSecondPerson,
    presentFirstPerson + pastSuffix + "e",
    presentFirstPerson + pastSuffix + "en",
    pastParticiple,
  ];

  // Remove duplicates while preserving order
  const seen = new Set<string>();
  const uniqueForms: string[] = [];

  for (const form of forms) {
    if (!seen.has(form)) {
      seen.add(form);
      uniqueForms.push(form);
    }
  }

  return uniqueForms;
}
