import { jsonCopy } from "./json-copy.ts";

/** Draft fields accepted from pasted JSON, AI drafts and prompt defaults. */
export type PromptDefaults = {
  term?: string;
  senseCue?: string;
  extra?: string;
  examples?: string[];
  related?: string[];
  collocations?: string[];
  partOfSpeech?: string;
  tags?: string[];
  forms?: string[];
  irregular?: boolean;
  separable?: boolean;
  uncountable?: boolean;
  constructionType?: ConstructionType;
};

export const constructionTypes = [
  "verbal phrase",
  "noun phrase",
  "adverbial phrase",
  "prepositional phrase",
  "conjunctional phrase",
  "participle phrase",
  "clause",
  "clause fragment",
  "indefinite pronoun phrase",
] as const;
export type ConstructionType = (typeof constructionTypes)[number];

export const partsOfSpeech = [
  "NOUN",
  "VERB",
  "ADJ",
  "ADV",
  "PRON",
  "DET",
  "ADP",
  "CCONJ",
  "SCONJ",
  "INTJ",
  "PROPN",
  "NUM",
  "PART",
] as const;
export type PartOfSpeech = (typeof partsOfSpeech)[number];

const relationPrefixes = {
  synonym: "+",
  antonym: "-",
  wordFamily: "~",
  posVariation: "^",
  related: "",
} as const;

type Validation<T> = { value?: T; error?: string };

function optionalString(value: unknown, key: string, allowEmpty: boolean): Validation<string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return { error: jsonCopy.string(key) };
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) return { error: jsonCopy.nonEmptyString(key) };
  return { value: trimmed };
}

function optionalStringArray(value: unknown, key: string): Validation<string[]> {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return { error: jsonCopy.stringArray(key) };
  const trimmed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());
  if (trimmed.some((item) => !item)) return { error: jsonCopy.nonEmptyStrings(key) };
  return { value: trimmed };
}

function optionalBoolean(value: unknown, key: string): Validation<boolean> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "boolean") return { error: jsonCopy.boolean(key) };
  return { value };
}

function optionalConstructionType(value: unknown): Validation<ConstructionType> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return { error: jsonCopy.constructionString };
  const normalized = value.trim().toLowerCase();
  if (!normalized) return {};
  const matched = constructionTypes.find((type) => type === normalized);
  if (!matched)
    return {
      error: jsonCopy.constructionChoices(constructionTypes.join(", ")),
    };
  return { value: matched };
}

function optionalPartOfSpeech(value: unknown): Validation<string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") return { error: jsonCopy.partString };
  const trimmed = value.trim();
  if (!(partsOfSpeech as readonly string[]).includes(trimmed))
    return {
      error: jsonCopy.partChoices,
    };
  return { value: trimmed };
}

function optionalRelations(value: unknown): Validation<string[]> {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) return { error: jsonCopy.relationsArray };
  const tokens: string[] = [];
  for (const item of value as unknown[]) {
    const relation: unknown = item;
    if (
      !relation ||
      typeof relation !== "object" ||
      Array.isArray(relation) ||
      !("type" in relation) ||
      !("term" in relation) ||
      typeof relation.type !== "string" ||
      typeof relation.term !== "string"
    )
      return { error: jsonCopy.relationObject };
    const type = relation.type.trim();
    const term = relation.term.trim();
    if (!(type in relationPrefixes)) return { error: jsonCopy.unknownRelation(relation.type) };
    if (!term) return { error: jsonCopy.relationTerm };
    tokens.push(`${Reflect.get(relationPrefixes, type)}${term}`);
  }
  return { value: tokens };
}

function parseDefaultsObject(object: Record<string, unknown>): {
  defaults?: PromptDefaults;
  error?: string;
} {
  const defaults: PromptDefaults = {};
  const steps: Array<[keyof PromptDefaults, Validation<unknown>]> = [
    ["term", optionalString(object.term, "term", false)],
    ["senseCue", optionalString(object.senseCue, "senseCue", true)],
    ["extra", optionalString(object.extra, "extra", true)],
    ["examples", optionalStringArray(object.examples, "examples")],
    ["collocations", optionalStringArray(object.collocations, "collocations")],
    ["tags", optionalStringArray(object.tags, "tags")],
    ["constructionType", optionalConstructionType(object.constructionType)],
    ["forms", optionalStringArray(object.forms, "forms")],
    ["irregular", optionalBoolean(object.irregular, "irregular")],
    ["separable", optionalBoolean(object.separable, "separable")],
    ["uncountable", optionalBoolean(object.uncountable, "uncountable")],
    ["partOfSpeech", optionalPartOfSpeech(object.partOfSpeech)],
    ["related", optionalRelations(object.relations)],
  ];
  for (const [key, result] of steps) {
    if (result.error) return { error: result.error };
    if (result.value !== undefined) (defaults as Record<string, unknown>)[key] = result.value;
  }
  return { defaults };
}

export type JsonDefaultsResult = {
  defaults?: PromptDefaults;
  defaultsList?: PromptDefaults[];
  warnings: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Parses a pasted draft object or array, keeping the legacy validation messages. */
export function parseJsonDefaults(input: string): { result?: JsonDefaultsResult; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : jsonCopy.parseFailed;
    return { error: jsonCopy.invalidJson(message) };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { error: jsonCopy.emptyArray };
    const defaultsList: PromptDefaults[] = [];
    for (const [index, item] of parsed.entries()) {
      if (!isRecord(item)) return { error: jsonCopy.entryObject(index) };
      const result = parseDefaultsObject(item);
      if (result.error) return { error: jsonCopy.entryError(index, result.error) };
      if (result.defaults) defaultsList.push(result.defaults);
    }
    return { result: { defaultsList, warnings: [] } };
  }
  if (!isRecord(parsed)) return { error: jsonCopy.objectOrArray };
  const result = parseDefaultsObject(parsed);
  if (result.error) return { error: result.error };
  return { result: { defaults: result.defaults, warnings: [] } };
}
