import type { EntryGrammar, VocabEntry } from "./vocab.types.js";

export interface VocabLanguagePolicy {
  readonly defaultLanguage: string;
  normalizeEntry(entry: VocabEntry): void;
  normalizePartOfSpeech(value: unknown): string | undefined;
  mergeGrammarUpdate(entry: VocabEntry, grammarUpdate: EntryGrammar | undefined): void;
  matchesTypeFilter(entry: VocabEntry, normalizedFilter: string): boolean;
}
