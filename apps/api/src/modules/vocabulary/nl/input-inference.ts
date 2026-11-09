import { resolveNlUPosFromPromptInput, type NlUPos } from "./languageSpec.js";

// Tag shortcuts mapping
const TAG_SHORTCUTS: Record<string, string> = {
  refl: "reflexive",
  sep: "separable",
  sing: "singular",
  pl: "plural",
  inf: "informal",
  dim: "diminutive",
  comp: "comparative",
  sup: "superlative",
  infl: "inflected",
};

/**
 * Resolve a part-of-speech input to the canonical name (handles shortcuts).
 */
export function resolvePartOfSpeechInput(input: string): NlUPos | undefined {
  return resolveNlUPosFromPromptInput(input);
}

/**
 * Resolve tag inputs to full names (handles shortcuts).
 */
export function resolveTagInputs(inputs: string[]): string[] {
  return inputs.map((input) => {
    const trimmed = input.trim().toLowerCase();

    // Check if it's a shortcut
    if (trimmed in TAG_SHORTCUTS) {
      return TAG_SHORTCUTS[trimmed]!;
    }

    // Return as-is if it's a known special tag or custom tag.
    return trimmed;
  });
}

function startsWithAllowedPrefix(parts: string[]): boolean {
  const ALLOWED_PREFIXES = new Set(["zich", "het", "de"]);
  return parts.length > 0 && ALLOWED_PREFIXES.has(parts[0]!.toLowerCase());
}

export function isPhraseEntry(word: string): boolean {
  const parts = word.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return false;
  if (parts.length > 2) return true;
  return !startsWithAllowedPrefix(parts);
}
