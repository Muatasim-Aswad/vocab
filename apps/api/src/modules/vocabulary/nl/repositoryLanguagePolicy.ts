import type { VocabLanguagePolicy } from "../language-policy.types.js";
import type { EntryGrammar, VocabEntry } from "../vocab.types.js";
import { asNlGrammar, type GrammarNL } from "./grammar.js";
import {
  isNlUPos,
  resolveNlUPosCandidatesForFilter,
  supportsInflectionForNlUPos,
} from "./languageSpec.js";
import { normalizeNlGrammarSignals } from "./utils/normalizeNlGrammarSignals.js";

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function mergeNlGrammarUpdate(entry: VocabEntry, grammarUpdate: EntryGrammar | undefined): void {
  const update = asNlGrammar(grammarUpdate);
  if (!update) {
    return;
  }

  const nextGrammar: Partial<GrammarNL> = {
    ...asNlGrammar(entry.grammar),
  };

  if (hasOwn(update, "article")) {
    if (update.article) {
      nextGrammar.article = update.article;
    } else {
      delete nextGrammar.article;
    }
  }

  if (hasOwn(update, "isReflexive")) {
    if (update.isReflexive) {
      nextGrammar.isReflexive = true;
    } else {
      delete nextGrammar.isReflexive;
    }
  }

  if (hasOwn(update, "isSeparable")) {
    if (update.isSeparable) {
      nextGrammar.isSeparable = true;
    } else {
      delete nextGrammar.isSeparable;
    }
  }

  if (hasOwn(update, "isCountable")) {
    // Explicit false means uncountable; only undefined clears the value.
    if (typeof update.isCountable === "boolean") {
      nextGrammar.isCountable = update.isCountable;
    } else {
      delete nextGrammar.isCountable;
    }
  }

  if (hasOwn(update, "isDiminutive")) {
    if (update.isDiminutive) {
      nextGrammar.isDiminutive = true;
    } else {
      delete nextGrammar.isDiminutive;
    }
  }

  if (hasOwn(update, "number")) {
    if (update.number !== undefined && update.number !== null) {
      nextGrammar.number = update.number;
    } else {
      delete nextGrammar.number;
    }
  }

  if (hasOwn(update, "irregular")) {
    if (update.irregular !== undefined && update.irregular !== null) {
      nextGrammar.irregular = update.irregular;
    } else {
      delete nextGrammar.irregular;
    }
  }

  if (Object.keys(nextGrammar).length > 0) {
    entry.grammar = nextGrammar;
  } else {
    delete entry.grammar;
  }
}

function normalizeNlEntry(entry: VocabEntry): void {
  const normalized = normalizeNlGrammarSignals({
    tags: entry.tags,
    grammar: entry.grammar,
    constructionTypes: entry.constructionType ? [entry.constructionType] : undefined,
    isMultiWord: entry.isMultiWord === true,
    preserveEmptyTags: false,
    preserveEmptyConstructionTypes: false,
  });

  if (normalized.tags) {
    entry.tags = normalized.tags;
  } else {
    delete entry.tags;
  }

  if (normalized.grammar) {
    entry.grammar = normalized.grammar;
  } else {
    delete entry.grammar;
  }

  if (normalized.constructionTypes && normalized.constructionTypes.length > 0) {
    entry.constructionType = normalized.constructionTypes[0];
  } else {
    delete entry.constructionType;
  }

  const grammar = asNlGrammar(entry.grammar);
  if (!grammar) {
    if (entry.isMultiWord) {
      delete entry.forms;
    }
    return;
  }

  if (entry.isMultiWord) {
    delete grammar.article;
    delete grammar.isReflexive;
    delete grammar.isSeparable;
    delete grammar.isCountable;
    delete grammar.isDiminutive;
    delete grammar.number;
    delete entry.forms;
    delete grammar.irregular;
  } else if (entry.partOfSpeech) {
    const isNoun = entry.partOfSpeech === "NOUN";
    const isVerb = entry.partOfSpeech === "VERB";
    const supportsInflection = supportsInflectionForNlUPos(entry.partOfSpeech);

    if (!isNoun) {
      delete grammar.article;
      delete grammar.number;
      delete grammar.isCountable;
      delete grammar.isDiminutive;
    }
    if (!isVerb) {
      delete grammar.isReflexive;
      delete grammar.isSeparable;
    }
    if (!supportsInflection) {
      delete entry.forms;
      delete grammar.irregular;
    }
  } else if (
    grammar.article ||
    grammar.number ||
    grammar.isCountable !== undefined ||
    grammar.isDiminutive
  ) {
    // Fallback invariant for entries that do not set partOfSpeech.
    delete grammar.isReflexive;
    delete grammar.isSeparable;
  } else if (grammar.isReflexive || grammar.isSeparable) {
    // Fallback invariant for entries that do not set partOfSpeech.
    delete grammar.article;
    delete grammar.number;
    delete grammar.isCountable;
    delete grammar.isDiminutive;
  }

  if (grammar.isReflexive === false) {
    delete grammar.isReflexive;
  }
  if (grammar.isSeparable === false) {
    delete grammar.isSeparable;
  }
  if (grammar.isDiminutive === false) {
    delete grammar.isDiminutive;
  }

  if (Object.keys(grammar).length === 0) {
    delete entry.grammar;
  } else {
    entry.grammar = grammar;
  }
}

function matchesNlTypeFilter(entry: VocabEntry, normalizedFilter: string): boolean {
  if (!normalizedFilter) {
    return true;
  }

  const grammar = asNlGrammar(entry.grammar);
  if (normalizedFilter === "irregular") {
    return grammar?.irregular === true;
  }
  if (normalizedFilter === "reflexive") {
    return grammar?.isReflexive === true;
  }
  if (normalizedFilter === "separable") {
    return grammar?.isSeparable === true;
  }
  if (normalizedFilter === "singular") {
    return grammar?.number === "singular" || grammar?.number === "both";
  }
  if (normalizedFilter === "plural") {
    return grammar?.number === "plural" || grammar?.number === "both";
  }
  if (normalizedFilter === "countable") {
    return grammar?.isCountable === true;
  }
  if (normalizedFilter === "uncountable") {
    return grammar?.isCountable === false;
  }
  if (normalizedFilter === "diminutive") {
    return grammar?.isDiminutive === true;
  }

  const posCandidates = resolveNlUPosCandidatesForFilter(normalizedFilter);
  const partOfSpeechMatches = entry.partOfSpeech
    ? posCandidates.length > 0
      ? posCandidates.some((candidate) => candidate === entry.partOfSpeech)
      : entry.partOfSpeech.toLowerCase().includes(normalizedFilter)
    : false;
  const constructionTypeMatches = entry.constructionType
    ? entry.constructionType.toLowerCase().includes(normalizedFilter)
    : false;
  const grammarSignalMatches =
    (entry.isMultiWord === true && "phrase".includes(normalizedFilter)) ||
    ((grammar?.isReflexive ?? false) && "reflexive".includes(normalizedFilter)) ||
    ((grammar?.isSeparable ?? false) && "separable".includes(normalizedFilter)) ||
    ((grammar?.isCountable ?? false) && "countable".includes(normalizedFilter)) ||
    (grammar?.isCountable === false && "uncountable".includes(normalizedFilter)) ||
    ((grammar?.isDiminutive ?? false) && "diminutive".includes(normalizedFilter)) ||
    ((grammar?.number === "singular" || grammar?.number === "both") &&
      "singular".includes(normalizedFilter)) ||
    ((grammar?.number === "plural" || grammar?.number === "both") &&
      "plural".includes(normalizedFilter));
  const tagMatches =
    entry.tags?.some((tag) => tag.toLowerCase().includes(normalizedFilter)) ?? false;

  return partOfSpeechMatches || constructionTypeMatches || grammarSignalMatches || tagMatches;
}

export const nlVocabLanguagePolicy: VocabLanguagePolicy = {
  defaultLanguage: "nl",
  normalizeEntry: normalizeNlEntry,
  normalizePartOfSpeech(value: unknown): string | undefined {
    return typeof value === "string" && isNlUPos(value) ? value : undefined;
  },
  mergeGrammarUpdate: mergeNlGrammarUpdate,
  matchesTypeFilter: matchesNlTypeFilter,
};
