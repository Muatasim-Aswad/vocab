import {
  AMBIGUOUS_SEPARATION_PREFIXES,
  INSEPARABLE_PREFIXES,
  SEPARABLE_PREFIXES,
} from "../constants.mjs";

export function checkSeparability(verb: string): {
  isSeparable: boolean;
  prefix: string | null;
  baseVerb: string;
  confidence: "High" | "Database-Verified" | "Ambiguous-Default-False" | "Base Verb";
} {
  // 1. HARD INSEPARABLE PREFIXES
  // These verbs are never separated.
  // Note: 'mis-' and 'vol-' are sometimes tricky, but usually inseparable in common verbs.

  for (const pre of INSEPARABLE_PREFIXES)
    if (verb.startsWith(pre))
      return {
        isSeparable: false,
        prefix: pre,
        baseVerb: verb.slice(pre.length),
        confidence: "High",
      };

  // 2. HARD SEPARABLE PREFIXES
  // Sanity check: Ensure the remaining part is long enough to be a verb
  // e.g., prevents "open" (op-en) false positives, though "open" is an adjective usually.
  for (const pre of SEPARABLE_PREFIXES)
    if (verb.startsWith(pre) && verb.length > pre.length + 2)
      return {
        isSeparable: true,
        prefix: pre,
        baseVerb: verb.slice(pre.length),
        confidence: "High",
      };

  // 3. AMBIGUOUS PREFIXES (The "Tricky" Ones)
  // context is needed, or a lookup list.
  for (const pre of AMBIGUOUS_SEPARATION_PREFIXES) {
    if (verb.startsWith(pre)) {
      // CHECK EXCEPTION LIST

      if (lookupAmbiguous(verb)) {
        return {
          isSeparable: true,
          prefix: pre,
          baseVerb: verb.slice(pre.length),
          confidence: "Database-Verified",
        };
      } else {
        return {
          isSeparable: false,
          prefix: pre,
          baseVerb: verb.slice(pre.length),
          confidence: "Ambiguous-Default-False",
        };
      }
    }
  }

  // 4. NO PREFIX DETECTED (Base verb)
  return { isSeparable: false, prefix: null, baseVerb: verb, confidence: "Base Verb" };
}

// A mini-database for the ambiguous cases
function lookupAmbiguous(verb: string) {
  // A list of KNOWN separable verbs in the ambiguous category.
  // In a real app, this should be a large JSON file or DB query.
  const separableWhitelist = new Set([
    // Door
    "doorgaan",
    "doorlopen",
    "doorkomen",
    "doorleven", // to live through
    "doorstaan",
    "doorbrengen",
    "doorwerken",
    // Om
    "omkijken",
    "omdraaien",
    "omkomen",
    "omvallen",
    "omgaan",
    "omzetten",
    // Onder
    "ondergaan" /* (sun sets) - ambiguous! 'ondergaan' (surgery) is inseparable */,
    "onderzoeken", // to investigate (actually usually inseparable in practice)
    // Over
    "oversteken",
    "overgeven",
    "overleggen",
    "overstappen",
    "overbrengen",
    "overgaan",
    // Voor
    "voorkomen" /* (occur) - ambiguous! */,
    "voorstellen",
    "voorbereiden",
    "voorzien", // to provide/foresee (can be separable in some contexts)
    "voordoen",
    "voorgaan",
    // Achter
    "achterlaten",
    "achtervolgen", // typically inseparable, but can be separable
    "achterblijven",
    // Weer
    "weergeven",
    "weerkeren",
  ]);

  return separableWhitelist.has(verb);
}
