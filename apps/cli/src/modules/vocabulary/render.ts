import type { Entry } from "@vocab/contracts";

import { s } from "../../platform/terminal.ts";
import { formatDisplayTerm, type EntryLookup } from "../../shared/display-term.ts";
import { formatDateTime } from "../../shared/format.ts";
import { renderCopy } from "./render-copy.ts";

export const isIrregular = (entry: Pick<Entry, "grammar">) =>
  (entry.grammar as { irregular?: unknown } | undefined)?.irregular === true;

/** Dutch part-of-speech codes shown after the term. */
const posCodes: Record<string, string> = {
  NOUN: "znw",
  ADJ: "bn",
  VERB: "ww",
  PRON: "vnw",
  DET: "lw",
  ADV: "bw",
  ADP: "vz",
  PART: "part",
  NUM: "tw",
  CCONJ: "vgw",
  SCONJ: "vgw",
  PROPN: "eigen",
  INTJ: "tw",
};
/** English UPOS shortcuts for non-Dutch or non-Dutch-UPOS values. */
const uposShortcuts: Record<string, string> = {
  ADJ: "adj",
  ADP: "prep",
  ADV: "adv",
  AUX: "aux",
  CCONJ: "cc",
  DET: "det",
  INTJ: "int",
  NOUN: "n",
  NUM: "num",
  PART: "part",
  PRON: "pron",
  PROPN: "propn",
  PUNCT: "punct",
  SCONJ: "sc",
  SYM: "sym",
  VERB: "v",
  X: "x",
};

function partOfSpeechCode(entry: Entry): string {
  const pos = entry.partOfSpeech;
  if (!pos) return "";
  if (entry.language === "nl" && posCodes[pos]) return posCodes[pos];
  return uposShortcuts[pos] ?? "";
}

export type DisplayWordOptions = {
  showPosition?: boolean;
  showRelated?: boolean;
  showExample?: boolean;
  showCollocations?: boolean;
  showExtra?: boolean;
  showDates?: boolean;
  showSenseCue?: boolean;
  highlightTerm?: string;
  highlightAll?: boolean;
  resolveEntryById?: EntryLookup;
  /** Entries sharing the display term; the viewer lists other active meanings. */
  siblings?: Entry[];
};

type HighlightState = { remaining: number };

function highlightMatches(
  text: string,
  term: string | undefined,
  baseStyle: (message: string) => string,
  highlightState?: HighlightState,
): string {
  if (!text) return text;
  if (!term) return baseStyle(text);
  if (highlightState && highlightState.remaining <= 0) return baseStyle(text);
  const needle = term.toLowerCase();
  if (!needle) return baseStyle(text);
  const haystack = text.toLowerCase();
  let start = 0;
  let index = haystack.indexOf(needle, start);
  if (index === -1) return baseStyle(text);
  let output = "";
  let remaining = highlightState?.remaining ?? Number.POSITIVE_INFINITY;
  while (index !== -1 && remaining > 0) {
    const before = text.slice(start, index);
    if (before) output += baseStyle(before);
    const match = text.slice(index, index + needle.length);
    if (match) output += s.highlight(match);
    start = index + needle.length;
    remaining -= 1;
    index = haystack.indexOf(needle, start);
  }
  const after = text.slice(start);
  if (after) output += baseStyle(after);
  if (highlightState) highlightState.remaining = remaining;
  return output || baseStyle(text);
}

const relationLabels = [
  ["synonym", renderCopy.relations.synonym],
  ["antonym", renderCopy.relations.antonym],
  ["wordFamily", renderCopy.relations.wordFamily],
  ["posVariation", renderCopy.relations.posVariation],
  ["related", renderCopy.relations.related],
] as const;

/** `term [cue]` for a relation target, or `#id` when it cannot be loaded. */
function relationTargetLabel(targetId: number, resolve?: EntryLookup): string {
  const target = resolve?.(targetId);
  if (!target) return `#${targetId}`;
  const term = formatDisplayTerm(target);
  return target.senseCue ? renderCopy.target(term, target.senseCue) : term;
}

export function relationGroups(entry: Entry, resolve?: EntryLookup): Array<[string, string[]]> {
  return relationLabels.flatMap(([type, label]) => {
    const targets = (entry.relations ?? [])
      .filter((relation) => relation.type === type)
      .map((relation) => relationTargetLabel(relation.targetEntryId, resolve));
    return targets.length > 0 ? [[label, targets] as [string, string[]]] : [];
  });
}

export function displayWord(
  view: (message: string) => void,
  entry: Entry,
  position: number | null = null,
  options: DisplayWordOptions = {},
): void {
  const {
    showPosition = true,
    showRelated = true,
    showExample = true,
    showCollocations = true,
    showExtra = false,
    showDates = false,
    showSenseCue = false,
    highlightTerm,
    highlightAll = false,
    resolveEntryById,
    siblings,
  } = options;
  const positionLabel = showPosition && position !== null ? renderCopy.position(position) : "";
  const indent = " ".repeat(positionLabel.length);
  const tags = entry.tags && entry.tags.length > 0 ? `[${entry.tags.join(" ,")}]` : "";
  const state = highlightTerm
    ? { remaining: highlightAll ? Number.POSITIVE_INFINITY : 1 }
    : undefined;
  const senseCue = entry.senseCue?.trim();
  const cueLabel = showSenseCue && senseCue ? renderCopy.cue(senseCue) : "";
  const termText = highlightMatches(formatDisplayTerm(entry), highlightTerm, s.w, state);
  view(
    renderCopy.entry(
      positionLabel,
      termText,
      cueLabel,
      partOfSpeechCode(entry),
      tags,
      isIrregular(entry) ? renderCopy.irregular : "",
      entry.id,
    ),
  );
  if (entry.forms && entry.forms.length > 0)
    view(`${indent}${highlightMatches(entry.forms.join(", "), highlightTerm, (m) => m, state)}`);
  if (showExample)
    for (const example of entry.examples ?? [])
      view(`${indent}${highlightMatches(example, highlightTerm, s.e, state)}`);
  if (showCollocations)
    for (const collocation of entry.collocations ?? [])
      view(`${indent}${highlightMatches(collocation, highlightTerm, s.r, state)}`);
  if (showExtra && entry.extra)
    view(`${indent}${highlightMatches(renderCopy.extra(entry.extra), highlightTerm, s.a, state)}`);
  if (showRelated)
    for (const [label, targets] of relationGroups(entry, resolveEntryById))
      view(
        `${indent}${highlightMatches(renderCopy.relation(label, targets.join(", ")), highlightTerm, s.e, state)}`,
      );
  if (siblings) {
    const others = siblings
      .filter((candidate) => candidate.id !== entry.id && candidate.status !== "stub")
      .toSorted((a, b) => a.id - b.id);
    if (others.length > 0) {
      const visible = others
        .slice(0, 5)
        .map((sibling) =>
          renderCopy.sibling(sibling.senseCue?.trim() || renderCopy.unnamedSense, sibling.id),
        );
      const remaining = others.length - visible.length;
      const summary =
        remaining > 0 ? renderCopy.more(visible.join(", "), remaining) : visible.join(", ");
      view(
        `${indent}${highlightMatches(renderCopy.otherMeanings(summary), highlightTerm, s.e, state)}`,
      );
    }
  }
  if (showDates) {
    view(`${indent}${formatDateTime(entry.meta.addedAt)}`);
    view(`${indent}${formatDateTime(entry.meta.modifiedAt)}`);
  }
}

export function displayWords(
  view: (message: string) => void,
  entries: Entry[],
  options: DisplayWordOptions & { startIndex?: number; spacing?: boolean } = {},
): void {
  const { startIndex = 0, spacing = true } = options;
  entries.forEach((entry, index) => {
    displayWord(view, entry, startIndex + index + 1, options);
    if (spacing && index < entries.length - 1) view("");
  });
}
