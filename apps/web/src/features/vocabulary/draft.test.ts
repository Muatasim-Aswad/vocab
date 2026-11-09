import { describe, expect, it } from "vite-plus/test";

import {
  buildCreateBody,
  effectiveDraft,
  emptyDraft,
  isDraftEmpty,
  shownSuggestedForms,
  suggestedFields,
  suggestedForms,
  validateDraft,
  type Draft,
  type Preparation,
} from "./draft.ts";

const prepared = (term: string, extra: Partial<Preparation["result"]> = {}): Preparation => ({
  term,
  result: {
    term: `de ${term}`,
    matches: [],
    formOf: [],
    inferred: {
      lemma: term,
      partOfSpeech: "NOUN",
      grammar: { article: "de" },
      forms: [`${term}en`],
    },
    ...extra,
  },
});

const draft = (patch: Partial<Draft>): Draft => ({ ...emptyDraft, ...patch });
const id = "01890a5d-ac96-7b3c-8b5e-4f7d0c9a1e2f";

describe("Add draft model", () => {
  it("builds a quick add from the term alone", () => {
    expect(buildCreateBody(draft({ term: "  het huis " }), null, id)).toEqual({
      mutationId: id,
      entry: { lemma: "het huis" },
      senseCueBackfills: [],
    });
    expect(isDraftEmpty(emptyDraft)).toBe(true);
    expect(isDraftEmpty(draft({ examples: ["  "] }))).toBe(true);
    expect(isDraftEmpty(draft({ extra: "x" }))).toBe(false);
  });

  it("merges API suggestions only into untouched fields, and forms only as shown suggestions", () => {
    const manual = draft({ term: "bank", partOfSpeech: "VERB", touched: ["partOfSpeech"] });
    const values = effectiveDraft(manual, prepared("bank"));
    expect(values.partOfSpeech).toBe("VERB");
    expect(values.article).toBe("de");
    expect(values.forms).toEqual([]);
    expect(suggestedFields(manual, prepared("bank"))).toEqual(["article"]);
    expect(buildCreateBody(manual, prepared("bank"), id).entry).toEqual({
      lemma: "bank",
      partOfSpeech: "VERB",
      grammar: { article: "de" },
      forms: ["banken"],
    });
  });

  it("suggests forms the draft neither has nor dismissed", () => {
    const suggesting = prepared("bank", {
      inferred: { lemma: "bank", forms: ["banken", "bankje", "bankjes"] },
    });
    expect(
      suggestedForms(
        draft({ term: "bank", forms: ["banken"], dismissedForms: ["bankje"] }),
        suggesting,
      ),
    ).toEqual(["bankjes"]);
  });

  it("saves suggested forms while shown: always without forms, on request with them", () => {
    const suggesting = prepared("bank", {
      inferred: { lemma: "bank", forms: ["banken", "bankje"] },
    });
    const hidden = draft({ term: "bank", forms: ["bankje"], showSuggestedForms: false });
    expect(shownSuggestedForms(hidden, suggesting)).toEqual([]);
    expect(buildCreateBody(hidden, suggesting, id).entry.forms).toEqual(["bankje"]);
    expect(shownSuggestedForms({ ...hidden, forms: [] }, suggesting)).toEqual(["banken", "bankje"]);
    const shown = { ...hidden, showSuggestedForms: true, dismissedForms: [] };
    expect(buildCreateBody(shown, suggesting, id).entry.forms).toEqual(["bankje", "banken"]);
  });

  it("ignores a preparation made for a different term", () => {
    const changed = draft({ term: "huis" });
    expect(effectiveDraft(changed, prepared("bank")).partOfSpeech).toBe("");
    expect(buildCreateBody(changed, prepared("bank"), id).entry).toEqual({ lemma: "huis" });
  });

  it("requires meaning labels for every unlabeled meaning when adding another", () => {
    const withMatches = prepared("bank", {
      matches: [
        { id: 3, revision: 2, lemma: "bank" },
        { id: 4, revision: 1, lemma: "bank", senseCue: "furniture" },
      ],
    });
    expect(validateDraft(draft({ term: "bank" }), withMatches)).toEqual({
      meanings: "vocab.add.error.chooseMeaning",
    });
    expect(validateDraft(draft({ term: "bank", addMeaning: true }), withMatches)).toEqual({
      senseCue: "vocab.add.error.labelRequired",
      "backfill-3": "vocab.add.error.labelRequired",
    });
    const complete = draft({
      term: "bank",
      addMeaning: true,
      senseCue: " river ",
      backfills: { 3: "money" },
    });
    expect(validateDraft(complete, withMatches)).toEqual({});
    expect(buildCreateBody(complete, withMatches, id)).toMatchObject({
      entry: { lemma: "bank", senseCue: "river" },
      senseCueBackfills: [{ id: 3, expectedRevision: 2, senseCue: "money" }],
    });
  });

  it("turns resolved and new relations into explicit tokens", () => {
    const body = buildCreateBody(
      draft({
        term: "lopen",
        relations: [
          {
            key: "a",
            type: "synonym",
            term: "wandelen",
            lookup: {
              status: "resolved",
              term: "wandelen",
              target: { id: 9, revision: 1, lemma: "wandelen" },
              candidates: [],
            },
          },
          {
            key: "b",
            type: "wordFamily",
            term: "de loop",
            lookup: { status: "new", term: "de loop" },
          },
          { key: "c", type: "related", term: " ", lookup: { status: "idle" } },
        ],
      }),
      null,
      id,
    );
    expect(body.entry.relatedTokens).toEqual(["+id:9", "~de loop"]);
    expect(
      validateDraft(
        draft({
          term: "lopen",
          relations: [{ key: "d", type: "related", term: "gaan", lookup: { status: "idle" } }],
        }),
        null,
      ),
    ).toEqual({ "relation-d": "vocab.add.error.findTarget" });
  });

  it("keeps optional details and drops blank rows", () => {
    const body = buildCreateBody(
      draft({
        term: "zich vergissen",
        extra: " to be mistaken ",
        examples: ["Ik vergis me.", " "],
        partOfSpeech: "VERB",
        isReflexive: true,
        irregular: false,
        collocations: ["zich vergissen in"],
        tags: ["Informal "],
        isCountable: "no",
        touched: ["partOfSpeech", "isReflexive"],
      }),
      null,
      id,
    );
    expect(body.entry).toEqual({
      lemma: "zich vergissen",
      extra: "to be mistaken",
      examples: ["Ik vergis me."],
      partOfSpeech: "VERB",
      grammar: { isReflexive: true, isCountable: false },
      collocations: ["zich vergissen in"],
      tags: ["Informal"],
    });
  });
});
