import type { MultiwordConstructionType } from "../../vocab.types.js";
import { multiwordConstructionTypes } from "../../vocab.types.js";
import type { GrammarNL } from "../grammar.js";

const TAG_ALIASES: Record<string, string> = {
  inf: "informal",
};

const CONSTRUCTION_TYPE_SET = new Set<MultiwordConstructionType>(multiwordConstructionTypes);
const MULTIWORD_STRUCTURAL_TAGS = new Set<string>(["phrase", "combination"]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTag(value: string): string {
  const normalized = normalizeText(value);
  return TAG_ALIASES[normalized] ?? normalized;
}

function isConstructionType(
  value: string,
  constructionTypeSet: ReadonlySet<string>,
): value is MultiwordConstructionType {
  return constructionTypeSet.has(value);
}

function pushUnique(values: string[], seen: Set<string>, value: string): void {
  if (!value || seen.has(value)) {
    return;
  }
  seen.add(value);
  values.push(value);
}

function enforceGrammarInvariants(grammar: Partial<GrammarNL>, isMultiWord: boolean): void {
  if (isMultiWord) {
    delete grammar.article;
    delete grammar.isReflexive;
    delete grammar.isSeparable;
    delete grammar.isCountable;
    delete grammar.isDiminutive;
    delete grammar.number;
    delete grammar.irregular;
  } else if (
    grammar.article ||
    grammar.number ||
    grammar.isCountable !== undefined ||
    grammar.isDiminutive
  ) {
    delete grammar.isReflexive;
    delete grammar.isSeparable;
  } else if (grammar.isReflexive || grammar.isSeparable) {
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
}

function normalizeConstructionTypes(
  values?: MultiwordConstructionType[],
  constructionTypeSet: ReadonlySet<string> = CONSTRUCTION_TYPE_SET,
): MultiwordConstructionType[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const next: MultiwordConstructionType[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const normalized = normalizeText(rawValue);
    if (!isConstructionType(normalized, constructionTypeSet) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

export function normalizeNlGrammarSignals(params: {
  tags?: string[];
  grammar?: Partial<GrammarNL>;
  constructionTypes?: MultiwordConstructionType[];
  constructionTypeAllowlist?: readonly string[];
  isMultiWord: boolean;
  preserveEmptyTags: boolean;
  preserveEmptyConstructionTypes?: boolean;
}): {
  tags?: string[];
  grammar?: Partial<GrammarNL>;
  constructionTypes?: MultiwordConstructionType[];
} {
  const constructionTypeSet =
    params.constructionTypeAllowlist && params.constructionTypeAllowlist.length > 0
      ? new Set(
          params.constructionTypeAllowlist.map((value) => normalizeText(value)).filter(Boolean),
        )
      : CONSTRUCTION_TYPE_SET;
  const nextGrammar: Partial<GrammarNL> = {
    ...params.grammar,
  };
  const preserveEmptyConstructionTypes = params.preserveEmptyConstructionTypes ?? false;
  const normalizedConstructionTypes =
    normalizeConstructionTypes(params.constructionTypes, constructionTypeSet) ?? [];
  const nextConstructionTypes: MultiwordConstructionType[] = params.isMultiWord
    ? [...normalizedConstructionTypes]
    : [];
  const seenConstructionTypes = new Set<string>(nextConstructionTypes);

  if (params.tags === undefined) {
    enforceGrammarInvariants(nextGrammar, params.isMultiWord);
    return {
      ...(Object.keys(nextGrammar).length > 0 ? { grammar: nextGrammar } : {}),
      ...(params.isMultiWord
        ? preserveEmptyConstructionTypes && params.constructionTypes !== undefined
          ? { constructionTypes: nextConstructionTypes }
          : nextConstructionTypes.length > 0
            ? { constructionTypes: nextConstructionTypes }
            : {}
        : {}),
    };
  }

  const nextTags: string[] = [];
  const seenTags = new Set<string>();

  for (const rawTag of params.tags) {
    const normalizedTag = normalizeTag(rawTag);
    if (!normalizedTag) {
      continue;
    }

    if (params.isMultiWord && isConstructionType(normalizedTag, constructionTypeSet)) {
      if (!seenConstructionTypes.has(normalizedTag)) {
        seenConstructionTypes.add(normalizedTag);
        nextConstructionTypes.push(normalizedTag);
      }
      continue;
    }

    if (!params.isMultiWord && isConstructionType(normalizedTag, constructionTypeSet)) {
      continue;
    }

    if (MULTIWORD_STRUCTURAL_TAGS.has(normalizedTag)) {
      continue;
    }

    pushUnique(nextTags, seenTags, normalizedTag);
  }

  enforceGrammarInvariants(nextGrammar, params.isMultiWord);

  return {
    ...(Object.keys(nextGrammar).length > 0 ? { grammar: nextGrammar } : {}),
    ...(params.preserveEmptyTags
      ? { tags: nextTags }
      : nextTags.length > 0
        ? { tags: nextTags }
        : {}),
    ...(params.isMultiWord
      ? preserveEmptyConstructionTypes && params.constructionTypes !== undefined
        ? { constructionTypes: nextConstructionTypes }
        : nextConstructionTypes.length > 0
          ? { constructionTypes: nextConstructionTypes }
          : {}
      : {}),
  };
}
