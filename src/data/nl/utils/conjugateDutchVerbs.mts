import { TKOFSHIP_ENDINGS, INSEPARABLE_PREFIXES, VOWELS, DIGRAPHS } from "../constants.mjs";

export function conjugateDutchVerb(infinitive: string): string[] {
  if (!infinitive.endsWith("en") || infinitive.length < 3) {
    throw new Error("Input must be a Dutch infinitive ending in 'en'");
  }

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
  const tORd = (stem: string): "t" | "d" => {
    const lastChar = stem[stem.length - 1];
    const lastTwoChars = stem.slice(-2);

    return TKOFSHIP_ENDINGS.includes(lastChar) || TKOFSHIP_ENDINGS.includes(lastTwoChars)
      ? "t"
      : "d";
  };

  // Get past participle prefix (ge- or not)
  const getPastParticiplePrefix = (infinitive: string): "" | "ge" => {
    return INSEPARABLE_PREFIXES.some((prefix) => infinitive.startsWith(prefix)) ? "" : "ge";
  };

  // Get the stem with proper spelling rules applied
  const presentFirstPerson = getStem(infinitive);
  const presentSecondPerson = getPresentSecondPerson(presentFirstPerson);
  const pastSuffix = tORd(presentFirstPerson);
  const pastParticiplePrefix = getPastParticiplePrefix(infinitive);

  // Fix Bug 3: Avoid double 't' or 'd' in past participle
  const pastParticipleSuffix =
    (presentFirstPerson.endsWith("t") && pastSuffix === "t") ||
    (presentFirstPerson.endsWith("d") && pastSuffix === "d")
      ? ""
      : pastSuffix;

  return [
    presentFirstPerson,
    presentSecondPerson,
    infinitive,
    presentFirstPerson + pastSuffix + "e",
    presentFirstPerson + pastSuffix + "en",
    pastParticiplePrefix + presentFirstPerson + pastParticipleSuffix,
  ];
}
