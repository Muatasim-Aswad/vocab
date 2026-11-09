import type { TFunction } from "i18next";

/** Built-in filters map to stable API filter values; anything else is a custom tag filter. */
export const typeFilters = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "phrase",
  "reflexive",
  "separable",
  "irregular",
  "countable",
  "uncountable",
  "plural",
  "diminutive",
] as const;
export const isBuiltIn = (value: string) => (typeFilters as readonly string[]).includes(value);

export const typeFilterLabel = (t: TFunction, value: string) =>
  isBuiltIn(value) ? t(`vocab.filter.${value}`) : value;
