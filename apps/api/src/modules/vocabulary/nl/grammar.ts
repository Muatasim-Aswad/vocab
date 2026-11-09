import type { EntryGrammar } from "../vocab.types.js";

type Article = "de" | "het";
type NounNumber = "singular" | "plural" | "both";

export type GrammarNL = {
  article?: Article; // noun article when applicable
  isReflexive?: boolean; // reflexive flag for single-word verbs (displayed as "zich <term>" in UI)
  isSeparable?: boolean; // separable-verb flag for single-word verbs
  isCountable?: boolean; // true for countable nouns; false when explicitly marked uncountable
  isDiminutive?: boolean; // set to true for single-word diminutive nouns, e.g. "vaatje"
  number?: NounNumber; // noun number classification for single-word nouns
  irregular?: boolean; // irregular inflection flag for single-word entries, e.g. "lopen" is irregular
};

export function asNlGrammar(grammar?: EntryGrammar): Partial<GrammarNL> | undefined {
  if (!grammar) {
    return undefined;
  }
  return grammar;
}
