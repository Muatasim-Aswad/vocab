import { asNlGrammar, type GrammarNL } from "./nl/grammar.js";
import {
  resolveNlUPosFromPromptInput,
  supportsInflectionForNlUPos,
  type NlUPos,
} from "./nl/languageSpec.js";
import { normalizeNlGrammarSignals } from "./nl/utils/normalizeNlGrammarSignals.js";
import type { CreateVocabEntry, UpdateVocabEntry, VocabEntry } from "./vocab.types.js";
import { multiwordConstructionTypes } from "./vocab.types.js";

type PartOfSpeechValue = NlUPos;
type ConstructionTypeValue = NonNullable<CreateVocabEntry["constructionType"]>;
type ParsedTermInput = {
  lemma: string;
  isMultiWord: boolean;
  grammar?: Pick<GrammarNL, "article" | "isReflexive">;
};

function normalizeStringListForCreate(values?: string[]): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeExamplesListForCreate(values?: string[]): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const deduped: string[] = [];
  for (const rawExample of values) {
    const normalized = normalizeExample(rawExample);
    if (!normalized) {
      continue;
    }
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped.length > 0 ? deduped : undefined;
}

function normalizeSenseCueForCreate(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = normalizeTerm(value);
  return normalized || undefined;
}

function normalizeSenseCueForUpdate(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeTerm(value);
}

function normalizeExtraForCreate(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeExtraForUpdate(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().replace(/\s+/g, " ");
}

function normalizeStringListForUpdate(values?: string[]): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function normalizeComparableLemma(rawTerm: string): string {
  const parsed = parseTermInput(rawTerm);
  return normalizeTerm(parsed.lemma || rawTerm);
}

export function filterLemmaFromForms(
  values: string[] | undefined,
  rawTerm: string,
  options: { preserveEmpty?: boolean } = {},
): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const normalizedLemma = normalizeComparableLemma(rawTerm);
  const filtered = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => normalizeComparableLemma(value) !== normalizedLemma);

  if (filtered.length > 0) {
    return filtered;
  }

  return options.preserveEmpty ? [] : undefined;
}

function normalizeExamplesListForUpdate(values?: string[]): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const deduped: string[] = [];
  for (const rawExample of values) {
    const normalized = normalizeExample(rawExample);
    if (!normalized) {
      continue;
    }
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped;
}

function normalizePartOfSpeechValue(value: unknown): PartOfSpeechValue | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return resolveNlUPosFromPromptInput(value);
}

function normalizePartOfSpeechForCreate(
  value?: CreateVocabEntry["partOfSpeech"],
): CreateVocabEntry["partOfSpeech"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizePartOfSpeechValue(value);
}

function normalizePartOfSpeechForUpdate(
  value?: UpdateVocabEntry["partOfSpeech"],
): UpdateVocabEntry["partOfSpeech"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizePartOfSpeechValue(value);
}

function normalizeConstructionTypeForCreate(
  value?: CreateVocabEntry["constructionType"],
): CreateVocabEntry["constructionType"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return multiwordConstructionTypes.find((candidate) => candidate === normalized);
}

function normalizeConstructionTypeForUpdate(
  value?: UpdateVocabEntry["constructionType"],
): UpdateVocabEntry["constructionType"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return multiwordConstructionTypes.find((candidate) => candidate === normalized);
}

function resolveConstructionTypeFromList(
  values?: ConstructionTypeValue[],
): ConstructionTypeValue | undefined {
  return values?.[0];
}

function normalizeTerm(rawTerm: string): string {
  return rawTerm.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeGrammarForCreate(input: ParsedTermInput): ParsedTermInput {
  if (input.isMultiWord) {
    return {
      lemma: input.lemma,
      isMultiWord: true,
    };
  }

  if (input.grammar?.article) {
    return {
      lemma: input.lemma,
      isMultiWord: false,
      grammar: {
        article: input.grammar.article,
      },
    };
  }

  if (input.grammar?.isReflexive) {
    return {
      lemma: input.lemma,
      isMultiWord: false,
      grammar: {
        isReflexive: true,
      },
    };
  }

  return {
    lemma: input.lemma,
    isMultiWord: false,
  };
}

function sanitizeGrammarForUpdate(input: { isMultiWord?: boolean; grammar?: Partial<GrammarNL> }): {
  isMultiWord?: boolean;
  grammar?: Partial<GrammarNL>;
} {
  const output = {
    ...input,
    ...(input.grammar ? { grammar: { ...input.grammar } } : {}),
  };

  if (output.isMultiWord === true) {
    if (output.grammar) {
      delete output.grammar.article;
      delete output.grammar.isReflexive;
      delete output.grammar.isSeparable;
      delete output.grammar.isCountable;
      delete output.grammar.isDiminutive;
      delete output.grammar.number;
      delete output.grammar.irregular;
      if (Object.keys(output.grammar).length === 0) {
        delete output.grammar;
      }
    }
    return output;
  }

  if (output.grammar?.article !== undefined) {
    delete output.grammar.isReflexive;
    delete output.grammar.isSeparable;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
    return output;
  }

  if (output.grammar?.number !== undefined) {
    delete output.grammar.isReflexive;
    delete output.grammar.isSeparable;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
    return output;
  }

  if (output.grammar?.isCountable !== undefined) {
    delete output.grammar.isReflexive;
    delete output.grammar.isSeparable;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
    return output;
  }

  if (output.grammar?.isDiminutive !== undefined && output.grammar.isDiminutive) {
    delete output.grammar.isReflexive;
    delete output.grammar.isSeparable;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
    return output;
  }

  if (output.grammar?.isReflexive !== undefined && output.grammar.isReflexive) {
    delete output.grammar.article;
    delete output.grammar.isCountable;
    delete output.grammar.isDiminutive;
    delete output.grammar.number;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
  }

  if (output.grammar?.isSeparable !== undefined && output.grammar.isSeparable) {
    delete output.grammar.article;
    delete output.grammar.isCountable;
    delete output.grammar.isDiminutive;
    delete output.grammar.number;
    if (Object.keys(output.grammar).length === 0) {
      delete output.grammar;
    }
  }

  return output;
}

export function parseTermInput(rawTerm: string): ParsedTermInput {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized) {
    return {
      lemma: "",
      isMultiWord: false,
    };
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return {
      lemma: normalized,
      isMultiWord: false,
    };
  }

  if (parts.length === 2) {
    const [prefix, token] = parts;
    if (prefix === "de" || prefix === "het") {
      return {
        lemma: token!,
        isMultiWord: false,
        grammar: {
          article: prefix,
        },
      };
    }

    if (prefix === "zich") {
      return {
        lemma: token!,
        isMultiWord: false,
        grammar: {
          isReflexive: true,
        },
      };
    }
  }

  return {
    lemma: normalized,
    isMultiWord: true,
  };
}

export function formatDisplayTerm(
  entry: Pick<VocabEntry, "lemma" | "isMultiWord" | "grammar">,
): string {
  const grammar = asNlGrammar(entry.grammar);

  if (entry.isMultiWord) {
    return entry.lemma;
  }

  if (grammar?.article) {
    return `${grammar.article} ${entry.lemma}`;
  }

  if (grammar?.isReflexive) {
    return `zich ${entry.lemma}`;
  }

  return entry.lemma;
}

function normalizeExample(rawExample: string): string {
  const trimmed = rawExample.trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  const last = normalized.charAt(normalized.length - 1);
  if (last !== "." && last !== "?" && last !== "!") {
    normalized += ".";
  }

  return normalized;
}

function normalizeGrammarForCreate(input: CreateVocabEntry): Partial<GrammarNL> | undefined {
  const inputGrammar = asNlGrammar(input.grammar);
  const grammar: Partial<GrammarNL> = {
    ...(inputGrammar?.article ? { article: inputGrammar.article } : {}),
    ...(inputGrammar?.isReflexive ? { isReflexive: true } : {}),
    ...(inputGrammar?.isSeparable !== undefined ? { isSeparable: inputGrammar.isSeparable } : {}),
    ...(inputGrammar?.isCountable !== undefined ? { isCountable: inputGrammar.isCountable } : {}),
    ...(inputGrammar?.isDiminutive ? { isDiminutive: true } : {}),
    ...(inputGrammar?.number ? { number: inputGrammar.number } : {}),
    ...(inputGrammar?.irregular !== undefined ? { irregular: inputGrammar.irregular } : {}),
  };

  return Object.keys(grammar).length > 0 ? grammar : undefined;
}

function normalizeGrammarForUpdate(input: UpdateVocabEntry): Partial<GrammarNL> | undefined {
  const inputGrammar = asNlGrammar(input.grammar);
  if (inputGrammar === undefined) {
    return undefined;
  }

  const grammar: Partial<GrammarNL> = {};

  if (inputGrammar.article !== undefined) {
    grammar.article = inputGrammar.article;
  }

  if (inputGrammar.isReflexive !== undefined) {
    grammar.isReflexive = inputGrammar.isReflexive;
  }

  if (inputGrammar.isSeparable !== undefined) {
    grammar.isSeparable = inputGrammar.isSeparable;
  }

  if (inputGrammar.isCountable !== undefined) {
    grammar.isCountable = inputGrammar.isCountable;
  }

  if (inputGrammar.isDiminutive !== undefined) {
    grammar.isDiminutive = inputGrammar.isDiminutive;
  }

  if (inputGrammar.number !== undefined) {
    grammar.number = inputGrammar.number;
  }

  if (inputGrammar.irregular !== undefined) {
    grammar.irregular = inputGrammar.irregular;
  }

  return grammar;
}

export function normalizeCreateVocabEntryInput(input: CreateVocabEntry): CreateVocabEntry {
  const parsedTerm = sanitizeGrammarForCreate(parseTermInput(input.lemma));
  const senseCue = normalizeSenseCueForCreate(input.senseCue);
  const extra = normalizeExtraForCreate(input.extra);
  const partOfSpeech = normalizePartOfSpeechForCreate(input.partOfSpeech);
  const constructionType = normalizeConstructionTypeForCreate(input.constructionType);
  const tags = normalizeStringListForCreate(input.tags);
  const relatedTokens = normalizeStringListForCreate(input.relatedTokens);
  const collocations = normalizeStringListForCreate(input.collocations);
  const examples = normalizeExamplesListForCreate(input.examples);
  const forms = filterLemmaFromForms(normalizeStringListForCreate(input.forms), parsedTerm.lemma);
  const supportsInflection = supportsInflectionForNlUPos(partOfSpeech);
  const normalizedForms =
    parsedTerm.isMultiWord || (partOfSpeech !== undefined && !supportsInflection)
      ? undefined
      : forms;

  const inputGrammar = normalizeGrammarForCreate(input);
  const mergedGrammar: Partial<GrammarNL> = {
    ...inputGrammar,
    ...(parsedTerm.grammar?.article ? { article: parsedTerm.grammar.article } : {}),
    ...(parsedTerm.grammar?.isReflexive ? { isReflexive: true } : {}),
  };

  const tagAndGrammar = normalizeNlGrammarSignals({
    tags,
    grammar: Object.keys(mergedGrammar).length > 0 ? mergedGrammar : undefined,
    constructionTypes: constructionType ? [constructionType] : undefined,
    isMultiWord: parsedTerm.isMultiWord,
    preserveEmptyTags: false,
    preserveEmptyConstructionTypes: false,
  });
  const normalizedConstructionType = resolveConstructionTypeFromList(
    tagAndGrammar.constructionTypes,
  );
  const sanitized = sanitizeGrammarForUpdate({
    isMultiWord: parsedTerm.isMultiWord,
    ...(tagAndGrammar.grammar ? { grammar: tagAndGrammar.grammar } : {}),
  });

  return {
    language: "nl",
    lemma: parsedTerm.lemma,
    ...(input.status ? { status: input.status } : {}),
    ...(senseCue ? { senseCue } : {}),
    ...(extra ? { extra } : {}),
    isMultiWord: parsedTerm.isMultiWord,
    ...(sanitized.grammar ? { grammar: sanitized.grammar } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(normalizedConstructionType ? { constructionType: normalizedConstructionType } : {}),
    ...(tagAndGrammar.tags ? { tags: tagAndGrammar.tags } : {}),
    ...(relatedTokens ? { relatedTokens } : {}),
    ...(collocations ? { collocations } : {}),
    ...(examples ? { examples } : {}),
    ...(normalizedForms ? { forms: normalizedForms } : {}),
  };
}

export function normalizeUpdateVocabEntryInput(input: UpdateVocabEntry): UpdateVocabEntry {
  const output: UpdateVocabEntry & { grammar?: Partial<GrammarNL> } = {};

  if (input.lemma !== undefined) {
    const parsedTerm = sanitizeGrammarForCreate(parseTermInput(input.lemma));
    if (parsedTerm.lemma) {
      output.lemma = parsedTerm.lemma;
      output.isMultiWord = parsedTerm.isMultiWord;
      if (parsedTerm.grammar) {
        output.grammar = {
          ...output.grammar,
          ...parsedTerm.grammar,
        };
      } else {
        output.grammar = {
          ...output.grammar,
          article: undefined,
          isReflexive: undefined,
        };
      }
    }
  }

  if (input.isMultiWord !== undefined) {
    output.isMultiWord = input.isMultiWord;
  }

  if (input.senseCue !== undefined) {
    output.senseCue = normalizeSenseCueForUpdate(input.senseCue);
  }

  if (input.extra !== undefined) {
    output.extra = normalizeExtraForUpdate(input.extra);
  }

  if (input.status !== undefined) {
    output.status = input.status;
  }

  const normalizedGrammar = normalizeGrammarForUpdate(input);
  if (normalizedGrammar !== undefined) {
    output.grammar = {
      ...output.grammar,
      ...normalizedGrammar,
    };
  }

  if (Object.prototype.hasOwnProperty.call(input, "partOfSpeech")) {
    output.partOfSpeech = normalizePartOfSpeechForUpdate(input.partOfSpeech);
  }

  if (Object.prototype.hasOwnProperty.call(input, "constructionType")) {
    output.constructionType = normalizeConstructionTypeForUpdate(input.constructionType);
  }

  if (input.tags !== undefined) {
    output.tags = normalizeStringListForUpdate(input.tags);
  }

  if (input.relatedTokens !== undefined) {
    output.relatedTokens = normalizeStringListForUpdate(input.relatedTokens);
  }

  if (input.collocations !== undefined) {
    output.collocations = normalizeStringListForUpdate(input.collocations);
  }

  if (input.examples !== undefined) {
    output.examples = normalizeExamplesListForUpdate(input.examples);
  }

  if (input.forms !== undefined) {
    output.forms = normalizeStringListForUpdate(input.forms);
    if (output.forms !== undefined && output.lemma !== undefined) {
      output.forms = filterLemmaFromForms(output.forms, output.lemma, {
        preserveEmpty: true,
      });
    }
  }

  if (input.meta !== undefined) {
    output.meta = { ...input.meta };
  }

  if (output.isMultiWord !== undefined) {
    const hasConstructionTypeUpdate = Object.prototype.hasOwnProperty.call(
      output,
      "constructionType",
    );
    const constructionTypesInput = hasConstructionTypeUpdate
      ? output.constructionType
        ? [output.constructionType]
        : []
      : undefined;
    const tagAndGrammar = normalizeNlGrammarSignals({
      tags: output.tags,
      grammar: output.grammar,
      constructionTypes: constructionTypesInput,
      isMultiWord: output.isMultiWord,
      preserveEmptyTags: true,
      preserveEmptyConstructionTypes: true,
    });
    if (output.tags !== undefined) {
      output.tags = tagAndGrammar.tags;
    }
    if (tagAndGrammar.grammar !== undefined) {
      output.grammar = tagAndGrammar.grammar;
    }
    if (hasConstructionTypeUpdate || tagAndGrammar.constructionTypes !== undefined) {
      output.constructionType = resolveConstructionTypeFromList(tagAndGrammar.constructionTypes);
    }
    if (!output.isMultiWord) {
      delete output.constructionType;
    } else {
      delete output.forms;
    }
  }

  if (output.partOfSpeech !== undefined && !supportsInflectionForNlUPos(output.partOfSpeech)) {
    delete output.forms;
  }

  const grammarInput: {
    isMultiWord?: boolean;
    grammar?: Partial<GrammarNL>;
  } = {};

  if (Object.prototype.hasOwnProperty.call(output, "isMultiWord")) {
    grammarInput.isMultiWord = output.isMultiWord;
  }
  if (Object.prototype.hasOwnProperty.call(output, "grammar")) {
    grammarInput.grammar = output.grammar;
  }

  if (Object.keys(grammarInput).length === 0) {
    return output;
  }

  const sanitized = sanitizeGrammarForUpdate(grammarInput);
  if (Object.prototype.hasOwnProperty.call(grammarInput, "grammar")) {
    if (sanitized.grammar) {
      output.grammar = sanitized.grammar;
    } else {
      delete output.grammar;
    }
  }

  return output;
}
