import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import {
  OppositeIcon,
  SeeAlsoIcon,
  SynonymIcon,
  WordFamilyIcon,
  WordTypeIcon,
} from "../../shared/icons.tsx";
import { partsOfSpeech, type Entry, type RelationType } from "./types.ts";

export type Headword = Pick<Entry, "lemma" | "grammar" | "isMultiWord">;

export function termPrefix(entry: Headword): string | undefined {
  const grammar = entry.grammar ?? {};
  if (entry.isMultiWord) return undefined;
  if (typeof grammar.article === "string") return grammar.article;
  return grammar.isReflexive === true ? "zich" : undefined;
}

/** The term as plain text, with its article or `zich`. */
export const headword = (entry: Headword) =>
  [termPrefix(entry), entry.lemma].filter(Boolean).join(" ");

export function partOfSpeechLabel(t: TFunction, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return (partsOfSpeech as readonly string[]).includes(value) ? t(`vocab.pos.${value}`) : value;
}

/** Display order and icon per relation; the type's name is the icon's tooltip and spoken label. */
export const relationRows: [RelationType, () => ReactNode][] = [
  ["synonym", SynonymIcon],
  ["antonym", OppositeIcon],
  ["wordFamily", WordFamilyIcon],
  ["posVariation", WordTypeIcon],
  ["related", SeeAlsoIcon],
];
