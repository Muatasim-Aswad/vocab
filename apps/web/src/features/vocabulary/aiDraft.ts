import {
  draftFromEntry,
  emptyDraft,
  inferableFields,
  type Draft,
  type InferableField,
  type RelationDraft,
} from "./draft.ts";
import type { Problem } from "./errors.ts";
import type {
  EntryDetail,
  GenerateBody,
  GeneratedDraft,
  MeaningMatch,
  Prepared,
  RelationType,
} from "./types.ts";

/** Names the conversion from a generated draft to the editable form, for later comparison. */
const aiAdapterVersion = "web-ai-draft-v1";

/** One client event about a suggestion, sent with a stable ID until the API records it. */
export interface Delivery {
  eventId: string;
  status: "idle" | "sending" | "sent" | "failed";
}

export interface Suggestion {
  /** The draft ID, or a local key for replayed generations that predate AI auditing. */
  key: string;
  draftId: string | null;
  draft: GeneratedDraft;
  presented: Delivery;
  /** Present once the user explicitly skipped this suggestion. */
  skipped: Delivery | null;
  saved: { id: number; lemma: string } | null;
}

/** The AI suggestion the form holds, with the form values it started from. */
export interface AiSource {
  key: string;
  generationId: string | null;
  draftId: string | null;
  editableBaseline: Record<string, unknown>;
}

/** Form content set aside while another suggestion, or the user's own draft, is open. */
export interface Stashed {
  draft: Draft;
  aiSource: AiSource | null;
  meaningBasis: Record<number, number> | null;
}

/** The own draft's stash key; suggestions use their own keys. */
export const ownDraft = "own";

/** AI's recommendation on whether a suggestion is one of its term's existing meanings. */
export type MatchState =
  | { status: "loading" }
  | { status: "ready"; match: MeaningMatch }
  | { status: "failed" };

export interface AiSession {
  /** Sent unchanged on every retry, so a replay returns the same generation. */
  request: GenerateBody & { requestId: string; term: string };
  /** Existing meanings of the typed term, which the user chose to add another meaning to. */
  known: number[];
  status: "generating" | "failed" | "unauthorized" | "existing" | "ready";
  problem: Problem | null;
  generationId: string | null;
  suggestions: Suggestion[];
  stash: Record<string, Stashed>;
  /** The suggestion being prepared for review, or the stub being read to complete. */
  opening: string | null;
  openProblem: Problem | null;
  /** Suggestions opened in the form; the others show as an entry to accept as it is. */
  editing: string[];
  /** Recommendations by suggestion key. */
  matches: Record<string, MatchState>;
  /** The suggestion whose recommendation is awaited before it opens. */
  comparing: string | null;
}

/** The open suggestion shows as an entry to accept, until it is opened in the form. */
export const isReviewing = (ai: AiSession | null, source: AiSource | null) =>
  source !== null && !(ai?.editing.includes(source.key) ?? false);

export function newSession(request: AiSession["request"], known: number[]): AiSession {
  return {
    request,
    known,
    status: "generating",
    problem: null,
    generationId: null,
    suggestions: [],
    stash: {},
    opening: null,
    openProblem: null,
    editing: [],
    matches: {},
    comparing: null,
  };
}

/**
 * What a suggestion means, for comparing it with existing meanings; absent when it has neither
 * notes nor an example to compare.
 */
export function meaningCandidate(draft: GeneratedDraft) {
  const extra = draft.extra?.trim();
  const examples = filledList(draft.examples);
  if (!extra && !examples.length) return undefined;
  const senseCue = draft.senseCue?.trim();
  const partOfSpeech = draft.partOfSpeech?.trim();
  return {
    term: draft.term.trim(),
    ...(senseCue && { senseCue }),
    ...(extra && { extra }),
    ...(partOfSpeech && { partOfSpeech }),
    ...(examples.length && { examples }),
  };
}

/** Senses the term already has, so a request for another meaning avoids them. */
export function existingSenses(prepared: Prepared) {
  return prepared.matches.flatMap((match) => {
    const senseCue = match.senseCue?.trim();
    const example = match.examples?.[0]?.trim();
    return senseCue || example
      ? [{ ...(senseCue && { senseCue }), ...(example && { example }) }]
      : [];
  });
}

export function suggestionsFrom(
  drafts: GeneratedDraft[],
  requestId: string,
  eventId: () => string,
): Suggestion[] {
  return drafts.map((draft, index) => ({
    key: draft.draftId ?? `${requestId}:${index}`,
    draftId: draft.draftId ?? null,
    draft,
    presented: { eventId: eventId(), status: "idle" },
    skipped: null,
    saved: null,
  }));
}

export function aiProvenance(source: AiSource | null) {
  if (!source?.generationId || !source.draftId) return undefined;
  return {
    generationId: source.generationId,
    drafts: [{ draftId: source.draftId, editableBaseline: source.editableBaseline }],
    adapterVersion: aiAdapterVersion,
  };
}

const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const tokenTypes: Record<string, RelationType> = {
  "+": "synonym",
  "-": "antonym",
  "~": "wordFamily",
  "^": "posVariation",
};

function relationsFrom(draft: GeneratedDraft): Array<{ type: RelationType; term: string }> {
  const tokens = (draft.relatedTokens ?? []).flatMap((token) => {
    const type = tokenTypes[token[0] ?? ""];
    const term = (type ? token.slice(1) : token).trim();
    return term && !term.startsWith("id:") ? [{ type: type ?? "related", term }] : [];
  });
  return [...(draft.relations ?? []), ...tokens];
}

function mergeRelations(base: RelationDraft[], draft: GeneratedDraft, key: string) {
  const known = new Set(base.map((relation) => `${relation.type}:${relation.term.toLowerCase()}`));
  const added = relationsFrom(draft).flatMap(({ type, term }, index) => {
    const id = `${type}:${term.trim().toLowerCase()}`;
    if (!term.trim() || known.has(id)) return [];
    known.add(id);
    return [
      { key: `${key}-${index}`, type, term: term.trim(), lookup: { status: "idle" as const } },
    ];
  });
  return [...base, ...added];
}

const filledList = (values: string[] | undefined) =>
  values?.map((value) => value.trim()).filter(Boolean) ?? [];

/**
 * The editable form for a generated draft. The model's values count as given, so API suggestions
 * only fill what it left out, and its term as the word itself even when it is another entry's form. Separability applies to verbs and countability to nouns; fields the
 * form cannot edit are dropped.
 */
export function draftFromAi(draft: GeneratedDraft, key: string): Draft {
  const base: Draft = { ...emptyDraft, term: draft.term.trim(), keepTerm: true };
  const grammar = draft.grammar ?? {};
  const partOfSpeech = draft.partOfSpeech?.trim() || base.partOfSpeech;
  const article =
    grammar.article === "de" || grammar.article === "het" ? grammar.article : undefined;
  const isReflexive = flag(grammar.isReflexive);
  const isSeparable =
    partOfSpeech === "VERB" ? (draft.separable ?? flag(grammar.isSeparable)) : undefined;
  const irregular = draft.irregular ?? flag(grammar.irregular);
  const isCountable =
    partOfSpeech === "NOUN"
      ? (flag(grammar.isCountable) ??
        (draft.uncountable === undefined ? undefined : !draft.uncountable))
      : undefined;
  const number =
    grammar.number === "singular" || grammar.number === "plural" || grammar.number === "both"
      ? grammar.number
      : undefined;
  const examples = filledList(draft.examples);
  const forms = filledList(draft.forms);
  const collocations = filledList(draft.collocations);
  const tags = filledList(draft.tags);
  const given: Array<[InferableField, boolean]> = [
    ["partOfSpeech", Boolean(draft.partOfSpeech?.trim())],
    ["article", article !== undefined],
    ["isReflexive", isReflexive !== undefined],
    ["isSeparable", isSeparable !== undefined],
    ["irregular", irregular !== undefined],
    ["forms", forms.length > 0],
    ["tags", tags.length > 0],
  ];
  const touched = [
    ...base.touched,
    ...given.flatMap(([field, value]) => (value && !base.touched.includes(field) ? [field] : [])),
  ];
  return {
    ...base,
    senseCue: draft.senseCue?.trim() || base.senseCue,
    extra: draft.extra?.trim() || base.extra,
    examples: examples.length ? examples : base.examples,
    partOfSpeech,
    article: article ?? base.article,
    isReflexive: isReflexive ?? base.isReflexive,
    isSeparable: isSeparable ?? base.isSeparable,
    irregular: irregular ?? base.irregular,
    isDiminutive: flag(grammar.isDiminutive) ?? base.isDiminutive,
    isCountable: isCountable === undefined ? base.isCountable : isCountable ? "yes" : "no",
    number: number ?? base.number,
    constructionType: draft.constructionType ?? base.constructionType,
    forms: forms.length ? forms : base.forms,
    showSuggestedForms: forms.length ? false : base.showSuggestedForms,
    collocations: collocations.length ? collocations : base.collocations,
    tags: tags.length ? tags : base.tags,
    relations: mergeRelations(base.relations, draft, key),
    touched,
  };
}

const replacedFields = [
  "senseCue",
  "extra",
  "partOfSpeech",
  "article",
  "isReflexive",
  "isSeparable",
  "irregular",
  "isDiminutive",
  "isCountable",
  "number",
  "constructionType",
] as const;

const isSet = (value: unknown) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

const union = (first: string[], second: string[]) => [
  ...new Set([...filledList(first), ...filledList(second)]),
];

/**
 * An existing entry the user identified with a suggestion's meaning, as the form that completes
 * it. Every value the suggestion holds wins, and the entry's replaced values are kept in
 * `previous`; forms are replaced, other lists combined and relations kept. A stub keeps API
 * suggestions for what the suggestion left out.
 */
export function draftForSameMeaning(
  generated: GeneratedDraft,
  key: string,
  detail: EntryDetail,
): Draft {
  const suggested = draftFromAi(generated, key);
  const existing = draftFromEntry(suggested.term, detail);
  const previous: Draft["previous"] = {};
  const draft: Draft = { ...existing, keepTerm: true };
  for (const field of replacedFields) {
    const value = suggested[field];
    if (!isSet(value)) continue;
    if (isSet(existing[field]) && existing[field] !== value)
      Object.assign(previous, { [field]: existing[field] });
    Object.assign(draft, { [field]: value });
  }
  const forms = filledList(suggested.forms);
  if (forms.length) {
    if (existing.forms.length && existing.forms.join("\n") !== forms.join("\n"))
      previous.forms = existing.forms;
    draft.forms = forms;
  }
  const examples = union(suggested.examples, existing.examples);
  return {
    ...draft,
    examples: examples.length ? examples : [""],
    collocations: union(suggested.collocations, existing.collocations),
    tags: union(suggested.tags, existing.tags),
    relations: mergeRelations(existing.relations, generated, key),
    showSuggestedForms: draft.forms.length === 0,
    touched: detail.entry.status === "stub" ? suggested.touched : [...inferableFields],
    previous,
  };
}
