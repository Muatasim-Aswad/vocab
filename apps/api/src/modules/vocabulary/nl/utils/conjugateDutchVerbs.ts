import { BASE_IRREGULAR_VERBS_VALUES } from "../baseIrregularVerbs.js";
import { TKOFSHIP_ENDINGS, INSEPARABLE_PREFIXES, VOWELS, DIGRAPHS } from "../constants.js";

const IRREGULAR_PRESENT_STEM_OVERRIDES: Record<string, string> = {
  // "komen" is irregular and its present stem is "kom", not "koom".
  komen: "kom",
};

// Apply standard Dutch spelling rules to get the correct stem
const getStem = (infinitive: string): string => {
  let stem = infinitive.slice(0, -2);

  let lastChar = stem[stem.length - 1];
  let secondLastChar = stem[stem.length - 2];

  // Dutch final devoicing: v → f, z → s.
  if (lastChar === "v") stem = stem.slice(0, -1) + "f";
  else if (lastChar === "z") stem = stem.slice(0, -1) + "s";

  lastChar = stem[stem.length - 1];
  secondLastChar = stem[stem.length - 2];

  // A double consonant marks a short vowel: pakken → pakk → pak.
  let hadDoubleConsonant = false;
  if (stem.length >= 3 && lastChar === secondLastChar && !VOWELS.includes(lastChar ?? "")) {
    stem = stem.slice(0, -1);
    hadDoubleConsonant = true;
  }

  lastChar = stem[stem.length - 1];
  secondLastChar = stem[stem.length - 2];

  // Preserve a long vowel unless it is a digraph or followed a double consonant.
  if (
    !hadDoubleConsonant &&
    stem.length >= 2 &&
    !VOWELS.includes(lastChar ?? "") &&
    VOWELS.includes(secondLastChar ?? "")
  ) {
    const vowel = secondLastChar;
    const thirdLastChar = stem[stem.length - 3];

    const possibleDigraph = thirdLastChar! + vowel!;
    const isDigraph = DIGRAPHS.includes(possibleDigraph) || DIGRAPHS.includes(vowel ?? "");

    if (!isDigraph && vowel !== "i") {
      stem = stem.slice(0, -1) + vowel! + lastChar!;
    }
  }

  return stem;
};

// Helper function for jij/hij/zij/het form (add -t)
const getPresentSecondPerson = (stem: string): string => {
  if (stem.endsWith("t")) return stem;
  return stem + "t";
};

// Get past tense suffix based on 't kofschip rule
// IMPORTANT: Check the original stem BEFORE devoicing (v→f, z→s)
const tORd = (infinitive: string): "t" | "d" => {
  const originalStem = infinitive.slice(0, -2);
  const lastChar = originalStem[originalStem.length - 1];
  const lastTwoChars = originalStem.slice(-2);

  return TKOFSHIP_ENDINGS.includes(lastChar ?? "") || TKOFSHIP_ENDINGS.includes(lastTwoChars)
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

const withInflectedSuffix = (form: string): string => `${form}e`;

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

  const joinedInfinitive = isSeparable && prefix ? `${prefix}${baseVerb}` : infinitive;

  const toSplitSeparable = (baseForm: string): string =>
    isSeparable && prefix ? `${baseForm} ${prefix}` : baseForm;
  const toJoinedSeparable = (baseForm: string): string =>
    isSeparable && prefix ? `${prefix}${baseForm}` : baseForm;

  type VerbFormSlots = {
    present: {
      firstPerson: string;
      firstPersonJoined?: string;
      secondThirdPerson: string;
      secondThirdPersonJoined?: string;
      infinitiveSplitOrBase: string;
      infinitiveJoined?: string;
    };
    past: {
      singularSplitOrBase: string;
      singularJoined?: string;
      pluralSplitOrBase: string;
      pluralJoined?: string;
    };
    participles: {
      pastParticiple: string;
      pastParticipleInflected: string;
      presentParticipleJoinedOrBase: string;
      presentParticipleInflected: string;
    };
  };

  const buildSlots = (base: {
    present1: string;
    present23: string;
    pastSg: string;
    pastPl: string;
    pastParticiple: string;
  }): VerbFormSlots => {
    const presentParticipleBase = `${base.present1}end`;

    if (isSeparable && prefix) {
      const presentParticipleJoined = toJoinedSeparable(presentParticipleBase);
      return {
        present: {
          firstPerson: toSplitSeparable(base.present1),
          firstPersonJoined: toJoinedSeparable(base.present1),
          secondThirdPerson: toSplitSeparable(base.present23),
          secondThirdPersonJoined: toJoinedSeparable(base.present23),
          infinitiveSplitOrBase: toSplitSeparable(baseVerb),
          infinitiveJoined: joinedInfinitive,
        },
        past: {
          singularSplitOrBase: toSplitSeparable(base.pastSg),
          singularJoined: toJoinedSeparable(base.pastSg),
          pluralSplitOrBase: toSplitSeparable(base.pastPl),
          pluralJoined: toJoinedSeparable(base.pastPl),
        },
        participles: {
          pastParticiple: base.pastParticiple,
          pastParticipleInflected: withInflectedSuffix(base.pastParticiple),
          presentParticipleJoinedOrBase: presentParticipleJoined,
          presentParticipleInflected: withInflectedSuffix(presentParticipleJoined),
        },
      };
    }

    return {
      present: {
        firstPerson: base.present1,
        secondThirdPerson: base.present23,
        infinitiveSplitOrBase: infinitive,
      },
      past: {
        singularSplitOrBase: base.pastSg,
        pluralSplitOrBase: base.pastPl,
      },
      participles: {
        pastParticiple: base.pastParticiple,
        pastParticipleInflected: withInflectedSuffix(base.pastParticiple),
        presentParticipleJoinedOrBase: presentParticipleBase,
        presentParticipleInflected: withInflectedSuffix(presentParticipleBase),
      },
    };
  };

  const flattenSlotsToUniqueForms = (slots: VerbFormSlots): string[] => {
    const rawForms = [
      slots.present.firstPerson,
      slots.present.firstPersonJoined,
      slots.present.secondThirdPerson,
      slots.present.secondThirdPersonJoined,
      slots.present.infinitiveSplitOrBase,
      slots.present.infinitiveJoined,
      slots.past.singularSplitOrBase,
      slots.past.singularJoined,
      slots.past.pluralSplitOrBase,
      slots.past.pluralJoined,
      slots.participles.pastParticiple,
      slots.participles.pastParticipleInflected,
      slots.participles.presentParticipleJoinedOrBase,
      slots.participles.presentParticipleInflected,
    ];

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const value of rawForms) {
      if (!value) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      unique.push(value);
    }
    return unique;
  };

  const buildExtendedUniqueForms = (base: {
    present1: string;
    present23: string;
    pastSg: string;
    pastPl: string;
    pastParticiple: string;
  }): string[] => flattenSlotsToUniqueForms(buildSlots(base));

  // Get the stem with proper spelling rules applied
  const stemVerb = isSeparable && baseVerb ? baseVerb : infinitive;
  const irregularLookupVerb = baseVerb || infinitive;
  const presentFirstPerson =
    isIrregular && IRREGULAR_PRESENT_STEM_OVERRIDES[irregularLookupVerb]
      ? IRREGULAR_PRESENT_STEM_OVERRIDES[irregularLookupVerb]
      : getStem(stemVerb);
  const presentSecondPerson = getPresentSecondPerson(presentFirstPerson);

  // If irregular, fetch past forms from dictionary
  if (isIrregular) {
    const lookupVerb = irregularLookupVerb;
    const irregularForms = Object.entries(BASE_IRREGULAR_VERBS_VALUES).find(
      ([verb]) => verb === lookupVerb,
    )?.[1];
    if (irregularForms) {
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
      let finalPastSingular = pastSingular ?? "";
      let finalPastPlural = pastPlural ?? "";
      let finalPastParticiple = pastParticiple ?? "";

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

      return buildExtendedUniqueForms({
        present1: presentFirstPerson,
        present23: presentSecondPerson,
        pastSg: finalPastSingular,
        pastPl: finalPastPlural,
        pastParticiple: finalPastParticiple,
      });
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

  return buildExtendedUniqueForms({
    present1: presentFirstPerson,
    present23: presentSecondPerson,
    pastSg: presentFirstPerson + pastSuffix + "e",
    pastPl: presentFirstPerson + pastSuffix + "en",
    pastParticiple,
  });
}
