import { describe, expect, it } from "vite-plus/test";

import { aiProvenance, draftFromAi, existingSenses } from "./aiDraft.ts";
import { editableSnapshot, type Preparation } from "./draft.ts";
import type { GeneratedDraft, Prepared } from "./types.ts";

const draftId = "0192a6b4-0000-7000-8000-000000000101";
const generationId = "0192a6b4-0000-7000-8000-000000000100";

const prepared = (term: string, extra: Partial<Prepared> = {}): Preparation => ({
  term,
  result: { term, matches: [], formOf: [], inferred: { lemma: term }, ...extra },
});

describe("AI draft conversion", () => {
  it("fills the form from the model, applying flags only where the word type uses them", () => {
    const generated: GeneratedDraft = {
      draftId,
      term: " opstaan ",
      corrected: false,
      senseCue: "get up",
      extra: "to rise",
      examples: ["Ik sta op.", " "],
      partOfSpeech: "VERB",
      separable: true,
      irregular: true,
      uncountable: true,
      forms: ["stond op"],
      relations: [{ type: "antonym", term: "gaan liggen" }],
      relatedTokens: ["+opkomen", "id:3"],
    };
    const draft = draftFromAi(generated, draftId);
    expect(draft).toMatchObject({
      term: "opstaan",
      senseCue: "get up",
      extra: "to rise",
      examples: ["Ik sta op."],
      partOfSpeech: "VERB",
      isSeparable: true,
      irregular: true,
      isCountable: "",
      forms: ["stond op"],
      showSuggestedForms: false,
    });
    expect(draft.relations.map(({ type, term }) => [type, term])).toEqual([
      ["antonym", "gaan liggen"],
      ["synonym", "opkomen"],
    ]);
    expect(draft.touched.toSorted()).toEqual(
      ["forms", "irregular", "isSeparable", "partOfSpeech"].toSorted(),
    );
  });

  it("takes the baseline as Save would send it, naming fields filled by API preparation", () => {
    const draft = draftFromAi(
      { draftId, term: "huis", corrected: false, senseCue: "home", partOfSpeech: "NOUN" },
      draftId,
    );
    const baseline = editableSnapshot(
      draft,
      prepared("huis", {
        inferred: { lemma: "huis", grammar: { article: "het" }, forms: ["huizen"] },
      }),
    );
    expect(baseline).toEqual({
      lemma: "huis",
      senseCue: "home",
      partOfSpeech: "NOUN",
      grammar: { article: "het" },
      forms: ["huizen"],
      inferred: ["article", "forms"],
    });
  });

  it("gives provenance only for audited generations", () => {
    const source = { key: draftId, generationId, draftId, editableBaseline: { lemma: "huis" } };
    expect(aiProvenance(source)).toEqual({
      generationId,
      drafts: [{ draftId, editableBaseline: { lemma: "huis" } }],
      adapterVersion: "web-ai-draft-v1",
    });
    expect(aiProvenance({ ...source, generationId: null })).toBeUndefined();
    expect(aiProvenance(null)).toBeUndefined();
  });

  it("asks to avoid existing senses that have a label or an example", () => {
    const matches = [
      { id: 1, revision: 1, lemma: "bank", senseCue: "money", examples: ["Naar de bank."] },
      { id: 2, revision: 1, lemma: "bank", status: "stub" as const },
    ];
    expect(existingSenses({ term: "bank", matches, formOf: [], inferred: {} })).toEqual([
      { senseCue: "money", example: "Naar de bank." },
    ]);
  });
});
