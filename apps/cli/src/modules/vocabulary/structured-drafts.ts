import type { Entry, EntryChanges, EntryInput, PreparedEntry } from "../../infra/api.ts";
import type { PromptDefaults } from "./json-input.ts";
import { explicitRelationTokens, sanitizeDefaults } from "./prompter.ts";

export type Draft = {
  index: number;
  term: string;
  lemmaKey: string;
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
  constructionType?: PromptDefaults["constructionType"];
};

export type DraftAction =
  | { kind: "create" }
  | { kind: "update"; targetId: number }
  | { kind: "skip" };

export const normalizeCue = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const hasCue = (value: string | undefined) => Boolean(value && value.trim());

export function isValidCue(value: string | undefined): value is string {
  const trimmed = value?.trim() ?? "";
  const words = trimmed.split(" ").filter(Boolean).length;
  return Boolean(trimmed) && words >= 1 && words <= 2;
}

export function cueSet(values: Iterable<string | undefined>): Set<string> {
  const set = new Set<string>();
  for (const value of values) if (value?.trim()) set.add(normalizeCue(value));
  return set;
}

export const otherDraftCues = (drafts: Draft[], target: Draft) =>
  cueSet(drafts.map((draft) => (draft === target ? undefined : draft.senseCue)));

export function cueSuggestions(drafts: Draft[], exclude: ReadonlySet<string> = new Set()) {
  const seen = new Set<string>();
  const suggestions: Array<{ normalized: string; label: string }> = [];
  for (const draft of drafts) {
    const value = draft.senseCue?.trim();
    if (!isValidCue(value)) continue;
    const normalized = normalizeCue(value);
    if (exclude.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    suggestions.push({ normalized, label: value });
  }
  return suggestions;
}

function mergeUnique(
  existing: string[] | undefined,
  incoming: string[] | undefined,
  normalize: (value: string) => string,
  transform?: (value: string) => string,
): string[] | undefined {
  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) return;
    const value = transform ? transform(trimmed) : trimmed;
    if (!value) return;
    const key = normalize(value);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(value);
  };
  existing?.forEach(add);
  incoming?.forEach(add);
  return merged.length > 0 ? merged : undefined;
}

/** Capitalizes and punctuates an example the way stored examples are, so merges deduplicate. */
function normalizeExampleForMerge(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (!".?!".includes(normalized.charAt(normalized.length - 1))) normalized += ".";
  return normalized;
}

export function toCreatePayload(draft: Draft): EntryInput {
  const grammar = {
    ...(draft.irregular !== undefined && { irregular: draft.irregular }),
    ...(draft.separable !== undefined && { isSeparable: draft.separable }),
    ...(draft.uncountable !== undefined && { isCountable: !draft.uncountable }),
  };
  return {
    language: "nl",
    lemma: draft.term,
    ...(draft.senseCue !== undefined && { senseCue: draft.senseCue }),
    ...(draft.extra !== undefined && { extra: draft.extra }),
    ...(draft.examples !== undefined && { examples: draft.examples }),
    ...(draft.related !== undefined && { relatedTokens: draft.related }),
    ...(draft.collocations !== undefined && { collocations: draft.collocations }),
    ...(draft.partOfSpeech !== undefined && { partOfSpeech: draft.partOfSpeech }),
    ...(draft.tags !== undefined && { tags: draft.tags }),
    ...(draft.forms !== undefined && { forms: draft.forms }),
    ...(draft.constructionType !== undefined && { constructionType: draft.constructionType }),
    ...(Object.keys(grammar).length > 0 && { grammar }),
  };
}

/** Incoming lists merge into the existing entry; scalar fields replace it. */
export function toUpdatePayload(draft: Draft, existing: Entry | undefined): EntryChanges {
  const create = toCreatePayload(draft);
  const examples =
    create.examples !== undefined
      ? mergeUnique(existing?.examples, create.examples, (value) => value, normalizeExampleForMerge)
      : undefined;
  const related =
    create.relatedTokens !== undefined
      ? mergeUnique(
          existing ? explicitRelationTokens(existing) : undefined,
          create.relatedTokens,
          (value) => value.trim().toLowerCase(),
        )
      : undefined;
  const collocations =
    create.collocations !== undefined
      ? mergeUnique(existing?.collocations, create.collocations, (v) => v)
      : undefined;
  const tags =
    create.tags !== undefined ? mergeUnique(existing?.tags, create.tags, (v) => v) : undefined;
  return {
    lemma: create.lemma,
    ...(create.senseCue !== undefined && { senseCue: create.senseCue }),
    ...(create.extra !== undefined && { extra: create.extra }),
    ...(examples !== undefined && { examples }),
    ...(related !== undefined && { relatedTokens: related }),
    ...(collocations !== undefined && { collocations }),
    ...(create.partOfSpeech !== undefined && { partOfSpeech: create.partOfSpeech }),
    ...(tags !== undefined && { tags }),
    ...(create.forms !== undefined && { forms: create.forms }),
    ...(create.constructionType !== undefined && { constructionType: create.constructionType }),
    ...(create.grammar !== undefined && { grammar: create.grammar }),
  };
}

export function groupDrafts(defaultsList: PromptDefaults[], prepared: PreparedEntry[]) {
  const groups = new Map<string, { drafts: Draft[]; matches: number[] }>();
  defaultsList.forEach((defaults, index) => {
    const preparation = prepared[index]!;
    const { defaults: sanitized } = sanitizeDefaults(defaults);
    const draft: Draft = {
      index,
      term: preparation.term,
      lemmaKey: preparation.inferred.lemma ?? preparation.term,
      ...(sanitized.senseCue !== undefined && { senseCue: sanitized.senseCue }),
      ...(defaults.extra !== undefined && { extra: defaults.extra }),
      ...(sanitized.examples !== undefined && { examples: sanitized.examples }),
      ...(sanitized.related !== undefined && { related: sanitized.related }),
      ...(sanitized.collocations !== undefined && { collocations: sanitized.collocations }),
      ...(sanitized.partOfSpeech !== undefined && { partOfSpeech: sanitized.partOfSpeech }),
      ...(sanitized.tags !== undefined && { tags: sanitized.tags }),
      ...(sanitized.forms !== undefined && { forms: sanitized.forms }),
      ...(sanitized.irregular !== undefined && { irregular: sanitized.irregular }),
      ...(sanitized.separable !== undefined && { separable: sanitized.separable }),
      ...(sanitized.uncountable !== undefined && { uncountable: sanitized.uncountable }),
      ...(sanitized.constructionType !== undefined && {
        constructionType: sanitized.constructionType,
      }),
    };
    const group = groups.get(draft.lemmaKey);
    if (group) group.drafts.push(draft);
    else
      groups.set(draft.lemmaKey, {
        drafts: [draft],
        matches: preparation.matches.map((match) => match.id),
      });
  });
  return groups;
}

export function findExistingLabelConflict(
  existing: readonly Entry[],
  missingIds: ReadonlySet<number>,
): Entry | undefined {
  const seen = new Map<string, Entry>();
  for (const entry of existing) {
    if (!hasCue(entry.senseCue)) continue;
    const key = normalizeCue(entry.senseCue ?? "");
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, entry);
      continue;
    }
    if (missingIds.has(entry.id)) return entry;
    if (missingIds.has(previous.id)) return previous;
    return undefined;
  }
  return undefined;
}

export function findIncomingLabelConflict(drafts: readonly Draft[]): [Draft, Draft] | undefined {
  const seen = new Map<string, Draft>();
  for (const draft of drafts) {
    if (!hasCue(draft.senseCue)) continue;
    const key = normalizeCue(draft.senseCue ?? "");
    const previous = seen.get(key);
    if (previous) return [draft, previous];
    seen.set(key, draft);
  }
  return undefined;
}
