import type {
  ConstructionType,
  CreateBody,
  EntryDetail,
  EntrySummary,
  Prepared,
  RelationType,
  UpdateBody,
} from "./types.ts";

type RelationLookup =
  | { status: "idle" }
  | { status: "loading"; term: string }
  | { status: "new"; term: string }
  | { status: "choose"; term: string; candidates: EntrySummary[] }
  | { status: "resolved"; term: string; target: EntrySummary; candidates: EntrySummary[] }
  | { status: "failed"; term: string };

export interface RelationDraft {
  key: string;
  type: RelationType;
  term: string;
  lookup: RelationLookup;
}

export const inferableFields = [
  "partOfSpeech",
  "article",
  "isReflexive",
  "isSeparable",
  "irregular",
  "forms",
  "tags",
] as const;
export type InferableField = (typeof inferableFields)[number];

/** Fields that show what an existing entry held before an AI suggestion replaced it. */
export type PreviousField =
  | "senseCue"
  | "extra"
  | "partOfSpeech"
  | "article"
  | "isCountable"
  | "number"
  | "constructionType"
  | "forms";

/** Suggestions that fill untouched fields at once; suggested forms show as removable chips. */
const autoApplied = inferableFields.filter((field) => field !== "forms");

export interface Draft {
  term: string;
  extra: string;
  examples: string[];
  partOfSpeech: string;
  article: "" | "de" | "het";
  isReflexive: boolean;
  isSeparable: boolean;
  irregular: boolean;
  isDiminutive: boolean;
  isCountable: "" | "yes" | "no";
  number: "" | "singular" | "plural" | "both";
  constructionType: "" | ConstructionType;
  forms: string[];
  collocations: string[];
  tags: string[];
  relations: RelationDraft[];
  /** Suggested forms the user dismissed. */
  dismissedForms: string[];
  /** Suggested forms show, and are saved unless dismissed; an entry with forms asks first. */
  showSuggestedForms: boolean;
  /** The user chose to add another meaning to an existing term. */
  addMeaning: boolean;
  /** The labels for that meaning were given, so the fields replace them. */
  meaningsConfirmed: boolean;
  /** The existing entry of the term this draft edits, active or stub, instead of adding one. */
  editId: number | null;
  /** The user adds the term although other entries list it among their forms. */
  keepTerm: boolean;
  /** Values of the edited entry that an AI suggestion replaced. */
  previous: Partial<Pick<Draft, PreviousField>>;
  senseCue: string;
  /** Meaning labels for existing unlabeled meanings, by entry ID. */
  backfills: Record<number, string>;
  /** Inferable fields the user changed; API suggestions never overwrite these. */
  touched: InferableField[];
}

/** Read-only API preparation, valid only while `term` equals the draft's trimmed term. */
export interface Preparation {
  term: string;
  result: Prepared;
}

export const emptyDraft: Draft = {
  term: "",
  extra: "",
  examples: [""],
  partOfSpeech: "",
  article: "",
  isReflexive: false,
  isSeparable: false,
  irregular: false,
  isDiminutive: false,
  isCountable: "",
  number: "",
  constructionType: "",
  forms: [],
  collocations: [],
  tags: [],
  relations: [],
  dismissedForms: [],
  showSuggestedForms: true,
  addMeaning: false,
  meaningsConfirmed: false,
  editId: null,
  keepTerm: false,
  previous: {},
  senseCue: "",
  backfills: {},
  touched: [],
};

const filled = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);

export function isDraftEmpty(draft: Draft): boolean {
  return (
    !draft.term.trim() &&
    !draft.extra.trim() &&
    !draft.senseCue.trim() &&
    filled(draft.examples).length === 0 &&
    filled(draft.forms).length === 0 &&
    filled(draft.collocations).length === 0 &&
    filled(draft.tags).length === 0 &&
    draft.relations.every((relation) => !relation.term.trim()) &&
    Object.values(draft.backfills).every((value) => !value.trim()) &&
    !draft.partOfSpeech &&
    !draft.article &&
    !draft.isReflexive &&
    !draft.isSeparable &&
    !draft.irregular &&
    !draft.isDiminutive &&
    !draft.isCountable &&
    !draft.number &&
    !draft.constructionType
  );
}

export function currentPreparation(
  draft: Draft,
  preparation: Preparation | null,
): Prepared | undefined {
  return preparation && preparation.term === draft.term.trim() ? preparation.result : undefined;
}

type Inferred = Pick<Draft, InferableField>;

function suggestions(prepared: Prepared | undefined): Partial<Inferred> {
  if (!prepared) return {};
  const { inferred } = prepared;
  const grammar = inferred.grammar ?? {};
  return {
    ...(inferred.partOfSpeech && { partOfSpeech: inferred.partOfSpeech }),
    ...((grammar.article === "de" || grammar.article === "het") && { article: grammar.article }),
    ...(grammar.isReflexive === true && { isReflexive: true }),
    ...(grammar.isSeparable === true && { isSeparable: true }),
    ...(grammar.irregular === true && { irregular: true }),
    ...(inferred.forms?.length && { forms: inferred.forms }),
    ...(inferred.tags?.length && { tags: inferred.tags }),
  };
}

/** Draft values with API suggestions merged into untouched inferable fields. */
export function effectiveDraft(draft: Draft, preparation: Preparation | null): Draft {
  const suggested = suggestions(currentPreparation(draft, preparation));
  const result = { ...draft };
  for (const field of autoApplied) {
    if (!draft.touched.includes(field) && suggested[field] !== undefined)
      Object.assign(result, { [field]: suggested[field] });
  }
  return result;
}

/** Fields whose shown value currently comes from the API rather than the user. */
export function suggestedFields(draft: Draft, preparation: Preparation | null): InferableField[] {
  const suggested = suggestions(currentPreparation(draft, preparation));
  return autoApplied.filter(
    (field) => !draft.touched.includes(field) && suggested[field] !== undefined,
  );
}

/** Forms the API suggests that the draft neither has nor dismissed. */
export function suggestedForms(draft: Draft, preparation: Preparation | null): string[] {
  const known = new Set([...filled(draft.forms), ...draft.dismissedForms]);
  return (suggestions(currentPreparation(draft, preparation)).forms ?? []).filter(
    (form) => !known.has(form),
  );
}

/** Suggested forms currently shown, which the draft saves with its own forms. */
export function shownSuggestedForms(draft: Draft, preparation: Preparation | null): string[] {
  const shown = draft.showSuggestedForms || filled(draft.forms).length === 0;
  return shown ? suggestedForms(draft, preparation) : [];
}

/** The draft's values as saved: suggestions merged, and shown suggested forms included. */
function savedValues(draft: Draft, preparation: Preparation | null): Draft {
  const values = effectiveDraft(draft, preparation);
  return {
    ...values,
    forms: [...filled(values.forms), ...shownSuggestedForms(draft, preparation)],
  };
}

/** Existing meanings of the same term that have no meaning label yet. */
export const unlabeledMatches = (prepared: Prepared | undefined) =>
  prepared?.matches.filter((match) => !match.senseCue?.trim()) ?? [];

export const isStub = (match: EntrySummary) => match.status === "stub";

/** Other entries list the term among their forms, and the user has not chosen to add it anyway. */
export const formDecisionPending = (draft: Draft, prepared: Prepared | undefined) =>
  Boolean(prepared?.formOf.length) && !draft.keepTerm;

/** The entry the draft edits, while it is still a meaning of the prepared term. */
export function editTarget(draft: Draft, prepared: Prepared | undefined): EntrySummary | undefined {
  return prepared?.matches.find((match) => match.id === draft.editId);
}

/** A meaning label is required only to tell an entry apart from other meanings of its term. */
const editNeedsLabel = (prepared: Prepared) => prepared.matches.length > 1;

/** An edited entry shows its label when it has one or needs one. */
export const editShowsLabel = (prepared: Prepared, target: EntrySummary) =>
  editNeedsLabel(prepared) || Boolean(target.senseCue?.trim());

const relationPrefix: Record<RelationType, string> = {
  related: "",
  synonym: "+",
  antonym: "-",
  wordFamily: "~",
  posVariation: "^",
};

/** A relation token naming an existing entry by ID. */
const relationIdToken = (type: RelationType, id: number) => `${relationPrefix[type]}id:${id}`;

function relationToken(relation: RelationDraft): string | undefined {
  if (relation.lookup.status === "resolved")
    return relationIdToken(relation.type, relation.lookup.target.id);
  if (relation.lookup.status === "new")
    return `${relationPrefix[relation.type]}${relation.lookup.term}`;
  return undefined;
}

/** Field problems the browser detects without domain rules, keyed by field ID, in form order. */
export function validateDraft(
  draft: Draft,
  preparation: Preparation | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.term.trim()) errors.term = "vocab.add.error.termRequired";
  const prepared = currentPreparation(draft, preparation);
  const target = editTarget(draft, prepared);
  if (prepared && target) {
    if (editNeedsLabel(prepared) && !draft.senseCue.trim())
      errors.senseCue = "vocab.add.error.labelRequired";
  } else if (prepared?.matches.length) {
    if (!draft.addMeaning) errors.meanings = "vocab.add.error.chooseMeaning";
    else {
      if (!draft.senseCue.trim()) errors.senseCue = "vocab.add.error.labelRequired";
      for (const match of unlabeledMatches(prepared))
        if (!draft.backfills[match.id]?.trim())
          errors[`backfill-${match.id}`] = "vocab.add.error.labelRequired";
    }
  }
  for (const relation of draft.relations) {
    if (!relation.term.trim()) continue;
    const { status } = relation.lookup;
    if (status === "choose") errors[`relation-${relation.key}`] = "vocab.add.error.chooseTarget";
    else if (status === "failed")
      errors[`relation-${relation.key}`] = "vocab.add.error.lookupFailed";
    else if (status !== "resolved" && status !== "new")
      errors[`relation-${relation.key}`] = "vocab.add.error.findTarget";
  }
  return errors;
}

/** Entry fields of a validated draft, without its meaning label. */
function entryFields(values: Draft) {
  const grammar: Record<string, unknown> = {
    ...(values.article && { article: values.article }),
    ...(values.isReflexive && { isReflexive: true }),
    ...(values.isSeparable && { isSeparable: true }),
    ...(values.irregular && { irregular: true }),
    ...(values.isDiminutive && { isDiminutive: true }),
    ...(values.isCountable && { isCountable: values.isCountable === "yes" }),
    ...(values.number && { number: values.number }),
  };
  const examples = filled(values.examples);
  const forms = filled(values.forms);
  const collocations = filled(values.collocations);
  const tags = filled(values.tags);
  const relatedTokens = values.relations.flatMap((relation) => {
    const token = relation.term.trim() ? relationToken(relation) : undefined;
    return token ? [token] : [];
  });
  return {
    lemma: values.term.trim(),
    ...(values.extra.trim() && { extra: values.extra.trim() }),
    ...(examples.length && { examples }),
    ...(values.partOfSpeech && { partOfSpeech: values.partOfSpeech }),
    ...(Object.keys(grammar).length && { grammar }),
    ...(values.constructionType && { constructionType: values.constructionType }),
    ...(forms.length && { forms }),
    ...(collocations.length && { collocations }),
    ...(tags.length && { tags }),
    ...(relatedTokens.length && { relatedTokens }),
  };
}

/** The entry fields Save would submit for the draft, so it can be shown as an entry. */
export const savedEntryFields = (draft: Draft, preparation: Preparation | null) =>
  entryFields(savedValues(draft, preparation));

/**
 * The create request for a validated draft. A `labeled` form shows a meaning label even for a
 * term's first meaning, so a label it holds is saved.
 */
export function buildCreateBody(
  draft: Draft,
  preparation: Preparation | null,
  mutationId: string,
  labeled = false,
): CreateBody {
  const values = savedValues(draft, preparation);
  const prepared = currentPreparation(draft, preparation);
  const addingMeaning = Boolean(prepared?.matches.length) && values.addMeaning;
  const senseCue = values.senseCue.trim();
  return {
    mutationId,
    entry: {
      ...entryFields(values),
      ...((addingMeaning || (labeled && senseCue)) && { senseCue }),
    },
    senseCueBackfills: addingMeaning
      ? unlabeledMatches(prepared).map((match) => ({
          id: match.id,
          expectedRevision: match.revision,
          senseCue: (values.backfills[match.id] ?? "").trim(),
        }))
      : [],
  };
}

/** Grammar with every value present, so an edit clears what the draft leaves unset. */
function grammarChanges(values: Draft): Record<string, unknown> {
  return {
    article: values.article || null,
    isReflexive: values.isReflexive,
    isSeparable: values.isSeparable,
    irregular: values.irregular || null,
    isDiminutive: values.isDiminutive,
    isCountable: values.isCountable ? values.isCountable === "yes" : null,
    number: values.number || null,
  };
}

/**
 * The update that makes an existing entry match the draft: every field is sent, so emptied ones
 * are cleared, and relation tokens replace its relations. Sending the term makes completing a
 * stub a lexical change, which promotes it to an active entry.
 */
export function buildEditBody(
  draft: Draft,
  preparation: Preparation | null,
  target: EntrySummary,
  mutationId: string,
): UpdateBody {
  const values = savedValues(draft, preparation);
  const prepared = currentPreparation(draft, preparation);
  const { lemma, relatedTokens, ...fields } = entryFields(values);
  return {
    mutationId,
    expectedRevision: target.revision,
    changes: {
      ...(isStub(target) && { lemma }),
      extra: fields.extra ?? "",
      examples: fields.examples ?? [],
      partOfSpeech: values.partOfSpeech,
      grammar: grammarChanges(values),
      ...(values.constructionType && { constructionType: values.constructionType }),
      forms: fields.forms ?? [],
      collocations: fields.collocations ?? [],
      tags: fields.tags ?? [],
      relatedTokens: relatedTokens ?? [],
      ...(prepared && editShowsLabel(prepared, target) && { senseCue: values.senseCue.trim() }),
    },
  };
}

/**
 * A labeled draft's entry fields exactly as Save would submit them, except that related words are
 * listed as typed because they are looked up only when saving; `inferred` names the fields whose
 * value came from API preparation rather than the draft itself.
 */
export function editableSnapshot(
  draft: Draft,
  preparation: Preparation | null,
): Record<string, unknown> {
  const target = editTarget(draft, currentPreparation(draft, preparation));
  const { relatedTokens: _resolvedOnSave, ...fields } = target
    ? buildEditBody(draft, preparation, target, "").changes
    : buildCreateBody(draft, preparation, "", true).entry;
  const suggested: string[] = suggestedFields(draft, preparation);
  const relations = draft.relations
    .filter((relation) => relation.term.trim())
    .map((relation) => ({ type: relation.type, term: relation.term.trim() }));
  return {
    ...(target && { entryId: target.id, expectedRevision: target.revision }),
    ...fields,
    ...(relations.length && { relations }),
    inferred: shownSuggestedForms(draft, preparation).length ? [...suggested, "forms"] : suggested,
  };
}

const countable = (value: unknown): Draft["isCountable"] =>
  value === true ? "yes" : value === false ? "no" : "";

/**
 * A draft holding an existing entry's values under the typed term. A stub keeps API suggestions
 * for the fields it lacks; an active entry's values count as the user's own.
 */
export function draftFromEntry(term: string, detail: EntryDetail): Draft {
  const { entry } = detail;
  const grammar = entry.grammar ?? {};
  const number = grammar.number;
  return {
    ...emptyDraft,
    term,
    editId: entry.id,
    extra: entry.extra ?? "",
    examples: entry.examples?.length ? [...entry.examples] : [""],
    partOfSpeech: entry.partOfSpeech ?? "",
    article: grammar.article === "de" || grammar.article === "het" ? grammar.article : "",
    isReflexive: grammar.isReflexive === true,
    isSeparable: grammar.isSeparable === true,
    irregular: grammar.irregular === true,
    isDiminutive: grammar.isDiminutive === true,
    isCountable: countable(grammar.isCountable),
    number: number === "singular" || number === "plural" || number === "both" ? number : "",
    constructionType: entry.constructionType ?? "",
    forms: [...(entry.forms ?? [])],
    showSuggestedForms: !entry.forms?.length,
    collocations: [...(entry.collocations ?? [])],
    tags: [...(entry.tags ?? [])],
    relations: detail.relations.map((relation, index) => ({
      key: `e${entry.id}-${index}`,
      type: relation.type,
      term: relation.entry.lemma,
      lookup: {
        status: "resolved",
        term: relation.entry.lemma,
        target: relation.entry,
        candidates: [relation.entry],
      },
    })),
    senseCue: entry.senseCue ?? "",
    touched: entry.status === "stub" ? [] : [...inferableFields],
  };
}
