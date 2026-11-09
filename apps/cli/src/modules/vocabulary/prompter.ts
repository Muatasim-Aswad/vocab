import type { Entry, FormsResolution, PreparedEntry } from "../../infra/api.ts";
import { PromptAbortedError, s } from "../../platform/terminal.ts";
import { formatDisplayTerm } from "../../shared/display-term.ts";
import {
  constructionTypes,
  partsOfSpeech,
  type ConstructionType,
  type PartOfSpeech,
  type PromptDefaults,
} from "./json-input.ts";
import { promptCopy } from "./prompt-copy.ts";

export type Include = Partial<
  Record<
    | "term"
    | "senseCue"
    | "partOfSpeech"
    | "tags"
    | "constructionType"
    | "forms"
    | "irregular"
    | "related"
    | "examples"
    | "collocations",
    boolean
  >
>;

export type PromptResult = {
  lemma?: string;
  senseCue?: string;
  partOfSpeech?: PartOfSpeech;
  tags?: string[];
  constructionType?: ConstructionType;
  forms?: string[];
  irregular?: boolean;
  related?: string[];
  examples?: string[];
  collocations?: string[];
};

/** Server-owned Dutch inference the prompts offer as defaults. */
export type Inference = {
  inferred: PreparedEntry["inferred"] | undefined;
  forms: (request: {
    partOfSpeech: PartOfSpeech;
    irregular: boolean;
    separable: boolean | undefined;
  }) => Promise<FormsResolution>;
};

export type PromptIO = {
  ask: (question: string) => Promise<string>;
  view: (message: string) => void;
};

const tagShortcuts: Record<string, string> = {
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
const specialTags = ["comparative", "superlative", "inflected"];

/** Prompt shortcuts: canonical code, English name, or app shortcut (`n`, `v`, `adj`, `prep`, ...). */
const posNames: Record<PartOfSpeech, [string, string]> = {
  NOUN: ["noun", "n"],
  VERB: ["verb", "v"],
  ADJ: ["adjective", "adj"],
  ADV: ["adverb", "adv"],
  PRON: ["pronoun", "pron"],
  DET: ["determiner", "det"],
  ADP: ["adposition", "prep"],
  CCONJ: ["coordinating conjunction", "cc"],
  SCONJ: ["subordinating conjunction", "sc"],
  INTJ: ["interjection", "int"],
  PROPN: ["proper noun", "propn"],
  NUM: ["numeral", "num"],
  PART: ["particle", "part"],
};

function resolvePartOfSpeechInput(input: string): PartOfSpeech | undefined {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  const canonical = normalized.toUpperCase();
  const direct = partsOfSpeech.find((pos) => pos === canonical);
  if (direct) return direct;
  return partsOfSpeech.find((pos) => posNames[pos].includes(normalized));
}

const resolvePartOfSpeechInputs = (inputs: string[]) =>
  inputs.flatMap((input) => {
    const resolved = resolvePartOfSpeechInput(input);
    return resolved ? [resolved] : [];
  });

const resolveTagInputs = (inputs: string[]) =>
  inputs.map((input) => {
    const trimmed = input.trim().toLowerCase();
    return tagShortcuts[trimmed] ?? trimmed;
  });

/** Phrases (not `de`/`het`/`zich` + one word) get construction types instead of inflection prompts. */
function isPhraseEntry(word: string): boolean {
  const parts = word.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return false;
  if (parts.length > 2) return true;
  return !["zich", "het", "de"].includes(parts[0]!.toLowerCase());
}

const storedPartOfSpeech = (value: string | undefined): PartOfSpeech | undefined => {
  const canonical = value?.trim().toUpperCase();
  return partsOfSpeech.find((pos) => pos === canonical);
};

/** Comma list input; `add a, b` appends to the current list. */
export function processArrayInput(input: string, existing?: string[]): string[] {
  const trimmed = input.trim();
  if (!trimmed) return existing || [];
  const isAdd = trimmed.toLowerCase().startsWith("add ");
  const content = isAdd ? trimmed.slice(4).trim() : trimmed;
  const items = content
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (!isAdd || !existing) return items;
  const combined = [...existing];
  for (const item of items) if (!combined.includes(item)) combined.push(item);
  return combined;
}

type Sanitized = Omit<PromptDefaults, "partOfSpeech" | "extra"> & { partOfSpeech?: PartOfSpeech };

const text = (value: unknown, allowEmpty: boolean) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return !trimmed && !allowEmpty ? undefined : trimmed;
};
const list = (value: unknown, normalize: (item: string) => string) => {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const trimmed = item.trim();
    if (trimmed) result.push(normalize(trimmed));
  }
  return result;
};
const lower = (item: string) => item.toLowerCase();

/** Normalizes JSON/AI defaults; `has` records which fields were supplied. */
export function sanitizeDefaults(raw: PromptDefaults | undefined): {
  defaults: Sanitized;
  has: Record<keyof Sanitized, boolean>;
} {
  const defaults: Sanitized = {};
  const has = {
    term: false,
    senseCue: false,
    related: false,
    examples: false,
    collocations: false,
    partOfSpeech: false,
    tags: false,
    forms: false,
    irregular: false,
    separable: false,
    uncountable: false,
    constructionType: false,
  };
  if (!raw) return { defaults, has };
  const term = text(raw.term, false);
  if (term !== undefined) [defaults.term, has.term] = [term, true];
  const senseCue = text(raw.senseCue, true);
  if (senseCue !== undefined) [defaults.senseCue, has.senseCue] = [senseCue, true];
  const examples = list(raw.examples, (item) => item);
  if (examples) [defaults.examples, has.examples] = [examples, true];
  const related = list(raw.related, lower);
  if (related) [defaults.related, has.related] = [related, true];
  const collocations = list(raw.collocations, lower);
  if (collocations) [defaults.collocations, has.collocations] = [collocations, true];
  const posText = text(raw.partOfSpeech, false);
  const pos = posText === undefined ? undefined : resolvePartOfSpeechInput(posText);
  if (pos) [defaults.partOfSpeech, has.partOfSpeech] = [pos, true];
  const tags = list(raw.tags, lower);
  if (tags) {
    const resolved = tags.length === 0 ? [] : resolveTagInputs(tags);
    if (tags.length === 0 || resolved.length > 0) [defaults.tags, has.tags] = [resolved, true];
  }
  if (typeof raw.constructionType === "string") {
    const normalized = raw.constructionType.trim().toLowerCase();
    const matched = constructionTypes.find((type) => type === normalized);
    if (matched) [defaults.constructionType, has.constructionType] = [matched, true];
  }
  const forms = list(raw.forms, lower);
  if (forms) [defaults.forms, has.forms] = [forms, true];
  for (const key of ["irregular", "separable", "uncountable"] as const)
    if (typeof raw[key] === "boolean") [defaults[key], has[key]] = [raw[key], true];
  return { defaults, has };
}

const isClear = (input: string) => input.trim() === "-" || input.trim().toLowerCase() === "clear";
const isQuit = (input: string) => ["q", "quit"].includes(input.trim().toLowerCase());

async function askOrAbort(io: PromptIO, question: string): Promise<string> {
  const answer = await io.ask(question);
  if (isQuit(answer)) throw new PromptAbortedError();
  return answer;
}

const buildPrompt = (label: string, current?: string) =>
  promptCopy.field(label, current ? s.alert(current) : undefined);

async function promptStringField(
  io: PromptIO,
  label: string,
  current?: string,
): Promise<string | undefined> {
  const input = await askOrAbort(io, buildPrompt(label, current));
  if (isClear(input)) return "";
  return input.trim() || undefined;
}

async function promptArrayField(
  io: PromptIO,
  label: string,
  current: readonly string[] | undefined,
): Promise<string[] | undefined>;
async function promptArrayField<T>(
  io: PromptIO,
  label: string,
  current: readonly string[] | undefined,
  resolver: (items: string[]) => T[],
): Promise<T[] | undefined>;
async function promptArrayField<T>(
  io: PromptIO,
  label: string,
  current: readonly string[] | undefined,
  resolver?: (items: string[]) => T[],
): Promise<T[] | string[] | undefined> {
  const display = current ? current.map(String).join(", ") : "";
  const input = await askOrAbort(io, buildPrompt(label, display));
  if (isClear(input)) return [];
  if (!input.trim()) return undefined;
  const processed = processArrayInput(input, current ? [...current] : undefined);
  return resolver ? resolver(processed) : processed;
}

function displayInstructions(io: PromptIO, term: string): void {
  io.view(s.a(promptCopy.instructions));
  for (const line of promptCopy.guidance) io.view(line);
  io.view("");
  io.view(s.a(promptCopy.partsHeading));
  io.view(promptCopy.partsFirst);
  io.view(promptCopy.partsSecond);
  io.view("");
  io.view(s.a(promptCopy.tagsHeading));
  io.view(promptCopy.tags(specialTags.join(", ")));
  io.view(promptCopy.currentTerm(s.alert(term)));
  io.view("");
}

const relationToken: Record<string, string> = {
  synonym: "+",
  antonym: "-",
  wordFamily: "~",
  posVariation: "^",
  related: "",
};

export const explicitRelationTokens = (entry: Entry) =>
  (entry.relations ?? []).map(
    (relation) => `${relationToken[relation.type]}id:${relation.targetEntryId}`,
  );

/**
 * Field prompts for create and edit. Inference comes from the API (`prepareEntry`, `resolveForms`);
 * branching, defaults and cancellation stay local.
 */
export async function promptTermFields(
  io: PromptIO,
  term: string,
  options: {
    include?: Include;
    existingEntry?: Entry;
    defaults?: PromptDefaults;
    mode?: "create" | "edit";
    inference: Inference;
  },
): Promise<PromptResult> {
  const { include = {}, existingEntry, mode = "create", inference } = options;
  const result: PromptResult = {};
  const { defaults, has } = sanitizeDefaults(options.defaults);
  const existingTerm = existingEntry ? formatDisplayTerm(existingEntry) : undefined;
  displayInstructions(io, term);

  if (include.term) {
    const defaultTerm = has.term ? defaults.term : existingTerm;
    const input = await promptStringField(io, promptCopy.term, defaultTerm || term);
    if (input !== undefined) result.lemma = input;
    else if (has.term && defaultTerm !== undefined) result.lemma = defaultTerm;
  }

  if (include.senseCue) {
    const current = has.senseCue ? defaults.senseCue : existingEntry?.senseCue;
    const input = await promptStringField(io, promptCopy.senseCue, current);
    if (input !== undefined) result.senseCue = input;
    else if (has.senseCue && current !== undefined) result.senseCue = current;
    else if (mode === "edit" && current !== undefined) result.senseCue = current;
  }

  if (include.examples) {
    const current = has.examples ? defaults.examples : existingEntry?.examples;
    const input = await promptArrayField(io, promptCopy.examples, current);
    if (input !== undefined) result.examples = input;
    else if (has.examples && current !== undefined) result.examples = current;
  }

  if (include.related) {
    const fromExisting = existingEntry?.relations
      ? explicitRelationTokens(existingEntry)
      : undefined;
    const current = has.related ? defaults.related : fromExisting;
    const input = await promptArrayField(io, promptCopy.related, current);
    if (input !== undefined) result.related = input;
    else if (has.related && current !== undefined) result.related = current;
    else if (mode === "edit" && current) result.related = current;
  }

  if (include.collocations) {
    const current = has.collocations ? defaults.collocations : existingEntry?.collocations;
    const input = await promptArrayField(io, promptCopy.collocations, current);
    if (input !== undefined) result.collocations = input;
    else if (has.collocations && current !== undefined) result.collocations = current;
  }

  const isPhrase = isPhraseEntry(term);
  const inferred = isPhrase ? undefined : inference.inferred;
  const inferredPos = storedPartOfSpeech(inferred?.partOfSpeech);
  const inferredGrammar = inferred?.grammar as
    | { irregular?: unknown; isSeparable?: unknown }
    | undefined;
  /** Inferred tags belong to the inferred part of speech only. */
  const inferredTagsFor = (pos: PartOfSpeech | undefined) =>
    pos && pos === inferredPos && (pos === "NOUN" || pos === "VERB")
      ? (inferred?.tags ?? [])
      : undefined;
  let verifiedPos: PartOfSpeech | undefined;

  if (include.constructionType && isPhrase) {
    const current = has.constructionType
      ? defaults.constructionType
      : existingEntry?.constructionType;
    const input = await promptStringField(io, promptCopy.construction, current);
    if (input !== undefined) {
      const normalized = input.trim().toLowerCase();
      const matched = constructionTypes.find((type) => type === normalized);
      if (matched) result.constructionType = matched;
    } else if (has.constructionType && current !== undefined) result.constructionType = current;
    else if (mode === "edit" && current !== undefined) result.constructionType = current;
  }

  if (include.partOfSpeech) {
    const existingPos = storedPartOfSpeech(existingEntry?.partOfSpeech);
    const current = has.partOfSpeech ? defaults.partOfSpeech : existingPos;
    const candidates = current ? [current] : inferredPos ? [inferredPos] : undefined;
    const input = await promptArrayField(
      io,
      promptCopy.partOfSpeech,
      candidates,
      resolvePartOfSpeechInputs,
    );
    if (input !== undefined) verifiedPos = input[0];
    else if (has.partOfSpeech && current !== undefined) verifiedPos = current;
    else if (!existingEntry && candidates) verifiedPos = candidates[0];
    else if (existingPos) verifiedPos = existingPos;
    if (input !== undefined || verifiedPos) result.partOfSpeech = verifiedPos;
  } else if (mode === "create") {
    verifiedPos = has.partOfSpeech ? defaults.partOfSpeech : inferredPos;
    if (verifiedPos) result.partOfSpeech = verifiedPos;
  } else {
    verifiedPos = storedPartOfSpeech(existingEntry?.partOfSpeech);
  }

  let separable = verifiedPos === "VERB" ? inferredGrammar?.isSeparable === true : undefined;
  if (include.tags) {
    const current = has.tags ? defaults.tags : existingEntry?.tags;
    const deduced =
      verifiedPos === "NOUN" || verifiedPos === "VERB"
        ? (current ?? inferredTagsFor(verifiedPos))
        : current;
    const input = await promptArrayField(io, promptCopy.tagsLabel, deduced, resolveTagInputs);
    if (input !== undefined) {
      result.tags = input;
      if (verifiedPos === "VERB") separable = input.includes("separable");
    } else if (has.tags && current !== undefined) result.tags = current;
    else if (mode === "edit" && deduced) result.tags = deduced;
    else if (!existingEntry && deduced) result.tags = deduced;
  } else if (mode === "create") {
    const deduced = inferredTagsFor(verifiedPos);
    if (deduced) result.tags = deduced;
  } else if (!isPhrase && existingEntry?.tags && verifiedPos === "VERB") {
    separable = existingEntry.tags.includes("separable");
  }

  let verifiedIrregular: boolean | undefined;
  if (!isPhrase && verifiedPos === "VERB") {
    const deducedIrregular = inferredPos === "VERB" && inferredGrammar?.irregular === true;
    const existingIrregular = existingEntry
      ? (existingEntry.grammar as { irregular?: boolean } | undefined)?.irregular
      : undefined;
    const current = has.irregular ? defaults.irregular : existingIrregular;
    if (include.irregular) {
      const value = current ?? deducedIrregular;
      const answer = await askOrAbort(io, promptCopy.irregular(s.alert(value ? "y" : "n")));
      if (answer.trim()) verifiedIrregular = answer.toLowerCase() === "y";
      else if (has.irregular && current !== undefined) verifiedIrregular = current;
      else verifiedIrregular = mode === "edit" ? value : deducedIrregular;
    } else {
      verifiedIrregular = current ?? deducedIrregular;
    }
    result.irregular = verifiedIrregular;
  }

  if (
    include.forms &&
    !isPhrase &&
    (verifiedPos === "VERB" || verifiedPos === "NOUN" || verifiedPos === "ADJ")
  ) {
    const label =
      verifiedPos === "VERB"
        ? promptCopy.verbForms
        : verifiedPos === "NOUN"
          ? promptCopy.nounForms
          : promptCopy.adjectiveForms;
    const existingForms = existingEntry?.forms?.length ? existingEntry.forms : undefined;
    const generated =
      has.forms || existingForms
        ? undefined
        : (
            await inference.forms({
              partOfSpeech: verifiedPos,
              irregular: verifiedIrregular ?? false,
              separable,
            })
          ).inferredForms;
    const current = has.forms ? defaults.forms : (existingForms ?? generated);
    const input = await promptArrayField(io, label, current);
    if (input !== undefined) result.forms = input;
    else if (has.forms && current) result.forms = current;
    else if (mode === "edit" && current) result.forms = current;
    else if (!existingEntry && generated) result.forms = generated;
  }

  return result;
}
