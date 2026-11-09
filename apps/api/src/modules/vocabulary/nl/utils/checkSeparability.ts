import { BASE_IRREGULAR_VERBS } from "../baseIrregularVerbs.js";
import {
  AMBIGUOUS_SEPARATION_PREFIXES,
  INSEPARABLE_PREFIXES,
  SEPARABLE_PREFIXES,
} from "../constants.js";
import {
  ambiguousInseparableVerbOverrides,
  ambiguousSeparableVerbOverrides,
} from "../lexicalHeuristics.js";

const irregularVerbSet = new Set(BASE_IRREGULAR_VERBS);
const VOWEL_RE = /[aeiouy]/i;

type SeparabilityResult = {
  isSeparable: boolean;
  prefix: string | null;
  baseVerb: string;
  confidence: "High" | "Database-Verified" | "Ambiguous-Default-False" | "Base Verb";
};

function buildResult(
  isSeparable: boolean,
  prefix: string | null,
  baseVerb: string,
  confidence: SeparabilityResult["confidence"],
): SeparabilityResult {
  return {
    isSeparable,
    prefix,
    baseVerb,
    confidence,
  };
}

function isLikelyInfinitive(verb: string): boolean {
  return verb.endsWith("en") || verb.endsWith("ën") || verb.endsWith("aan");
}

function isPlausibleBaseVerb(baseVerb: string): boolean {
  if (!isLikelyInfinitive(baseVerb)) {
    return false;
  }

  if (irregularVerbSet.has(baseVerb)) {
    return true;
  }

  const stem = baseVerb.slice(0, -2);
  if (stem.length < 3) {
    return false;
  }

  return VOWEL_RE.test(stem);
}

export function checkSeparability(verb: string): SeparabilityResult {
  // 1. HARD INSEPARABLE PREFIXES
  // These verbs are never separated.
  // Note: 'mis-' and 'vol-' are sometimes tricky, but usually inseparable in common verbs.

  for (const pre of INSEPARABLE_PREFIXES) {
    if (verb.startsWith(pre)) {
      return buildResult(false, pre, verb.slice(pre.length), "High");
    }
  }

  // 2. HARD SEPARABLE PREFIXES
  for (const pre of SEPARABLE_PREFIXES) {
    if (!verb.startsWith(pre)) {
      continue;
    }

    const baseVerb = verb.slice(pre.length);
    if (!isPlausibleBaseVerb(baseVerb)) {
      continue;
    }

    return buildResult(true, pre, baseVerb, "High");
  }

  // 3. AMBIGUOUS PREFIXES (The "Tricky" Ones)
  for (const pre of AMBIGUOUS_SEPARATION_PREFIXES) {
    if (!verb.startsWith(pre)) {
      continue;
    }

    const baseVerb = verb.slice(pre.length);
    if (!isPlausibleBaseVerb(baseVerb)) {
      continue;
    }

    if (ambiguousSeparableVerbOverrides.has(verb)) {
      return buildResult(true, pre, baseVerb, "Database-Verified");
    }

    if (ambiguousInseparableVerbOverrides.has(verb)) {
      return buildResult(false, pre, baseVerb, "Database-Verified");
    }

    return buildResult(false, pre, baseVerb, "Ambiguous-Default-False");
  }

  // 4. NO PREFIX DETECTED (Base verb)
  return buildResult(false, null, verb, "Base Verb");
}
