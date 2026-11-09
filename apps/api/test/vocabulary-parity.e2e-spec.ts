import { resolve, join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { Database } from "../src/infra/db/database.js";
import { StudyMemoryRepository } from "../src/modules/study/study-memory.repository.js";
import { StudyMemoryService } from "../src/modules/study/study-memory.service.js";
import {
  isPhraseEntry,
  resolvePartOfSpeechInput,
  resolveTagInputs,
} from "../src/modules/vocabulary/nl/input-inference.js";
import { nlVocabLanguagePolicy } from "../src/modules/vocabulary/nl/repositoryLanguagePolicy.js";
import { deduceDutchWordInfo } from "../src/modules/vocabulary/nl/utils/deduceDutchWordInfo.js";
import { parseRelatedToken } from "../src/modules/vocabulary/relation-tokens.js";
import type { CreateVocabEntry } from "../src/modules/vocabulary/vocab.types.js";
import { SqliteVocabRepository } from "../src/modules/vocabulary/vocabulary.repository.js";
import {
  formatDisplayTerm,
  normalizeCreateVocabEntryInput,
  normalizeUpdateVocabEntryInput,
  parseTermInput,
} from "../src/modules/vocabulary/word-normalization.js";
import { tempDir } from "./support.js";

const migrationsFolder = resolve(import.meta.dirname, "../drizzle");
const open: Array<{ database: Database; dir: ReturnType<typeof tempDir> }> = [];
afterEach(() => {
  for (const item of open.splice(0)) {
    item.database.close();
    item.dir.cleanup();
  }
});
function repo() {
  const dir = tempDir();
  const database = new Database({
    path: join(dir.dir, "vocab.sqlite"),
    migrationsFolder,
    create: true,
  });
  database.migrate();
  open.push({ database, dir });
  return {
    database,
    vocabulary: new SqliteVocabRepository(
      database,
      new StudyMemoryService(new StudyMemoryRepository(database)),
      {
        repositoryDeps: { nowIso: () => "2025-01-02T03:04:05.000Z" },
      },
    ),
  };
}
function create(vocabulary: SqliteVocabRepository, data: CreateVocabEntry) {
  const result = vocabulary.create(normalizeCreateVocabEntryInput(data));
  expect(result.success).toBe(true);
  return result.entry!;
}

describe("legacy vocabulary parity", () => {
  it("retains the cause of unexpected persistence failures", () => {
    const { database, vocabulary } = repo();
    database.sqlite.exec(
      "CREATE TRIGGER reject_entry BEFORE INSERT ON entries BEGIN SELECT RAISE(FAIL, 'private database detail'); END",
    );
    try {
      vocabulary.create({ lemma: "huis" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({
        reason: "PERSISTENCE_WRITE_FAILED",
        message: "Persisting data failed.",
        cause: expect.objectContaining({
          cause: expect.objectContaining({ message: "private database detail" }),
        }),
      });
    }
  });
  it("compatibility: term:case-space normalizes case and repeated spaces", () => {
    expect(parseTermInput("  HET   Huis ")).toEqual({
      lemma: "huis",
      isMultiWord: false,
      grammar: { article: "het" },
    });
    expect(normalizeCreateVocabEntryInput({ lemma: "  DE   Huis " }).lemma).toBe("huis");
  });
  it("compatibility: term:article keeps de and het in noun grammar", () => {
    expect(parseTermInput("de bank").grammar).toEqual({ article: "de" });
    expect(formatDisplayTerm(create(repo().vocabulary, { lemma: "het huis" }))).toBe("het huis");
  });
  it("compatibility: term:reflexive keeps zich as a grammar signal", () => {
    expect(parseTermInput("zich vergissen")).toEqual({
      lemma: "vergissen",
      isMultiWord: false,
      grammar: { isReflexive: true },
    });
  });
  it("compatibility: term:multiword distinguishes a phrase from article and reflexive prefixes", () => {
    expect(parseTermInput("het huis bouwen")).toEqual({
      lemma: "het huis bouwen",
      isMultiWord: true,
    });
    expect(parseTermInput("in de war").isMultiWord).toBe(true);
  });
  it("compatibility: term:examples capitalizes, punctuates and deduplicates", () => {
    expect(
      normalizeCreateVocabEntryInput({
        lemma: "bank",
        examples: ["  de bank is open", "de bank is open", "Hallo!"],
      }).examples,
    ).toEqual(["De bank is open.", "Hallo!"]);
  });
  it("compatibility: term:forms excludes forms equivalent to the lemma", () => {
    expect(
      normalizeCreateVocabEntryInput({ lemma: "huis", forms: ["huis", "huizen", "HUIZEN"] }).forms,
    ).toEqual(["huizen", "HUIZEN"]);
  });
  it("compatibility: term:tags moves structural tags without dropping lexical tags", () => {
    expect(
      normalizeCreateVocabEntryInput({ lemma: "in de war", tags: ["adjective phrase", "idiom"] })
        .tags,
    ).toContain("idiom");
  });
  it("compatibility: term:update-clear retains explicit empty updates", () => {
    const { vocabulary } = repo();
    const entry = create(vocabulary, { lemma: "bank", extra: "note", examples: ["example"] });
    const update = normalizeUpdateVocabEntryInput({ extra: "", examples: [], forms: [] });
    expect(update).toMatchObject({ extra: "", examples: [], forms: [] });
    expect(vocabulary.updateById(entry.id, update).entry).not.toHaveProperty("extra");
    expect(vocabulary.findById(entry.id)).not.toHaveProperty("examples");
  });
  it("compatibility: term:fields retains lexical fields, exact timestamps, memory and revisions", () => {
    const { vocabulary } = repo();
    const entry = create(vocabulary, {
      lemma: "de bank",
      senseCue: "money",
      extra: "note",
      partOfSpeech: "NOUN",
      examples: ["de bank is open"],
      collocations: ["op de bank"],
      tags: ["finance"],
      forms: ["banken"],
    });
    expect(entry).toMatchObject({
      lemma: "bank",
      senseCue: "money",
      extra: "note",
      partOfSpeech: "NOUN",
      grammar: { article: "de" },
      examples: ["De bank is open."],
      collocations: ["op de bank"],
      tags: ["finance"],
      forms: ["banken"],
      revision: 1,
      meta: { addedAt: "2025-01-02T03:04:05.000Z", modifiedAt: "2025-01-02T03:04:05.000Z" },
    });
    expect(entry.memory).toMatchObject({ strength: 1, difficulty: 2, streak: 0 });
  });
  it("compatibility: nl:pos matches the fixed Dutch noun, verb and adjective cases", () => {
    expect(
      ["de tafel", "het meisje", "kinderen"].map((word) => deduceDutchWordInfo(word).partOfSpeech),
    ).toEqual(["NOUN", "NOUN", "NOUN"]);
    expect(deduceDutchWordInfo("zich vergissen").partOfSpeech).toBe("VERB");
    expect(deduceDutchWordInfo("in de war").partOfSpeech).toBe("ADJ");
  });
  it("compatibility: nl:noun retains article, number and diminutive inference", () => {
    expect(deduceDutchWordInfo("het meisje").partOfSpeech).toBe("NOUN");
    expect(deduceDutchWordInfo("kinderen").partOfSpeech).toBe("NOUN");
    expect(deduceDutchWordInfo("de tafel").partOfSpeech).toBe("NOUN");
  });
  it("compatibility: nl:verb matches reflexive and separable legacy oracle", () => {
    expect(deduceDutchWordInfo("zich vergissen")).toMatchObject({
      partOfSpeech: "VERB",
      tags: ["reflexive"],
      verbInfo: { isSeparable: false, baseVerb: "gissen", irregular: false },
    });
    expect(deduceDutchWordInfo("aankomen")).toMatchObject({
      partOfSpeech: "VERB",
      tags: ["separable"],
      verbInfo: { isSeparable: true, baseVerb: "komen", irregular: true },
    });
  });
  it("compatibility: nl:adjective retains comparative and superlative forms", () => {
    expect(deduceDutchWordInfo("in de war")).toMatchObject({
      partOfSpeech: "ADJ",
      adjectiveInfo: { forms: ["in de war", "in de warre", "in de warrer", "in de warst"] },
    });
  });
  it("compatibility: nl:conflict resolves an article in the term over conflicting supplied grammar", () => {
    const entry = create(repo().vocabulary, { lemma: "de tafel", grammar: { article: "het" } });
    expect(entry.grammar?.article).toBe("de");
    expect(nlVocabLanguagePolicy.normalizePartOfSpeech("NOUN")).toBe("NOUN");
    expect(nlVocabLanguagePolicy.normalizePartOfSpeech("noun")).toBeUndefined();
    expect(resolvePartOfSpeechInput("noun")).toBe("NOUN");
    expect(resolveTagInputs(["refl", "sep", "custom"])).toEqual([
      "reflexive",
      "separable",
      "custom",
    ]);
  });
  it("compatibility: nl:multiword does not infer single-word forms for a phrase", () => {
    const phrase = create(repo().vocabulary, { lemma: "in de war" });
    expect(phrase.isMultiWord).toBe(true);
    expect(phrase.forms).toBeUndefined();
    expect(isPhraseEntry("in de war")).toBe(true);
    expect(isPhraseEntry("zich vergissen")).toBe(false);
  });
  it("compatibility: relation:typed parses typed and explicit ID tokens", () => {
    expect(parseRelatedToken("+onbekend")).toMatchObject({ type: "synonym", term: "onbekend" });
    expect(parseRelatedToken("^id:7")).toMatchObject({ type: "posVariation", targetEntryId: 7 });
    expect(parseRelatedToken("~komen")).toMatchObject({ type: "wordFamily", term: "komen" });
  });
  it("compatibility: relation:bidirectional creates symmetric typed edges and ignores self links", () => {
    const { vocabulary } = repo();
    const a = create(vocabulary, { lemma: "bank" });
    const b = create(vocabulary, { lemma: "zetel" });
    expect(
      vocabulary.updateById(a.id, { relatedTokens: [`+id:${b.id}`, `+id:${a.id}`] }).success,
    ).toBe(true);
    expect(vocabulary.findById(a.id)?.relations).toContainEqual({
      type: "synonym",
      targetEntryId: b.id,
    });
    expect(vocabulary.findById(b.id)?.relations).toContainEqual({
      type: "synonym",
      targetEntryId: a.id,
    });
    expect(vocabulary.findById(a.id)?.relations).not.toContainEqual({
      type: "synonym",
      targetEntryId: a.id,
    });
  });
  it("compatibility: relation:stub creates unresolved targets and prunes orphan stubs", () => {
    const { vocabulary } = repo();
    const a = create(vocabulary, { lemma: "bank", relatedTokens: ["+onbekend"] });
    const stub = vocabulary.findByTerm("onbekend")[0]!;
    expect(stub.status).toBe("stub");
    expect(vocabulary.updateById(a.id, { relatedTokens: [] }).success).toBe(true);
    expect(vocabulary.findById(stub.id)).toBeNull();
  });
  it("compatibility: relation:exclusive removes generic related links when a specific link is created", () => {
    const { vocabulary } = repo();
    const a = create(vocabulary, { lemma: "bank" });
    const b = create(vocabulary, { lemma: "zetel" });
    vocabulary.updateById(a.id, { relatedTokens: [`id:${b.id}`] });
    vocabulary.updateById(a.id, { relatedTokens: [`+id:${b.id}`] });
    expect(vocabulary.findById(a.id)?.relations).toEqual([
      { type: "synonym", targetEntryId: b.id },
    ]);
  });
  it("compatibility: relation:ambiguous preserves two meanings and requires an explicit target ID", () => {
    const { vocabulary } = repo();
    const first = create(vocabulary, { lemma: "bank", senseCue: "money" });
    const second = create(vocabulary, { lemma: "bank", senseCue: "seat" });
    expect(first.id).not.toBe(second.id);
    expect(vocabulary.findByLemma("bank")).toHaveLength(2);
    const source = create(vocabulary, { lemma: "kamer" });
    expect(() => vocabulary.updateById(source.id, { relatedTokens: ["+bank"] })).toThrow();
    expect(vocabulary.updateById(source.id, { relatedTokens: [`+id:${second.id}`] }).success).toBe(
      true,
    );
  });
  it("compatibility: search:rank orders lemma, form, relation, example and collocation matches", () => {
    const { vocabulary } = repo();
    const lemma = create(vocabulary, { lemma: "zoekterm" });
    const form = create(vocabulary, { lemma: "vorm", forms: ["zoekterm"] });
    const relation = create(vocabulary, { lemma: "relatie", relatedTokens: [`+id:${lemma.id}`] });
    const example = create(vocabulary, { lemma: "voorbeeld", examples: ["Zoekterm staat hier"] });
    const collocation = create(vocabulary, { lemma: "verbinding", collocations: ["zoekterm"] });
    expect(
      vocabulary.search("*zoekterm*", { includeAllFields: true }).entries.map((entry) => entry.id),
    ).toEqual([lemma.id, form.id, relation.id, example.id, collocation.id]);
  });
  it("compatibility: search:tie orders equal ranks by display term then entry ID", () => {
    const { vocabulary } = repo();
    const z = create(vocabulary, { lemma: "zebra" });
    const a = create(vocabulary, { lemma: "aard" });
    expect(vocabulary.search("*a*").entries.map((entry) => entry.id)).toEqual([a.id, z.id]);
  });
  it("compatibility: search:scope requires opt-in for examples and collocations", () => {
    const { vocabulary } = repo();
    const e = create(vocabulary, { lemma: "voorbeeld", examples: ["Zeldzaam woord"] });
    expect(vocabulary.search("*zeldzaam*").entries).toEqual([]);
    expect(
      vocabulary.search("*zeldzaam*", { includeAllFields: true }).entries.map((entry) => entry.id),
    ).toEqual([e.id]);
  });
  it("compatibility: search:literal treats percent and underscore as literal input", () => {
    const { vocabulary } = repo();
    const percent = create(vocabulary, { lemma: "a%b" });
    const underscore = create(vocabulary, { lemma: "a_b" });
    create(vocabulary, { lemma: "axb" });
    expect(vocabulary.search("a%").entries.map((entry) => entry.id)).toEqual([percent.id]);
    expect(vocabulary.search("a_").entries.map((entry) => entry.id)).toEqual([underscore.id]);
  });
  it("compatibility: search:type filters with the Dutch language policy", () => {
    const { vocabulary } = repo();
    const noun = create(vocabulary, { lemma: "de bank", partOfSpeech: "NOUN" });
    create(vocabulary, { lemma: "bankieren", partOfSpeech: "VERB" });
    expect(
      vocabulary.search("bank*", { typeFilter: "noun" }).entries.map((entry) => entry.id),
    ).toEqual([noun.id]);
  });
  it("filters multi-word entries as phrases even without a phrase type", () => {
    const { vocabulary } = repo();
    const phrase = create(vocabulary, { lemma: "in de war" });
    create(vocabulary, { lemma: "warm" });
    expect(vocabulary.paginate({ typeFilter: "phrase" }).entries.map((entry) => entry.id)).toEqual([
      phrase.id,
    ]);
  });
  it("compatibility: search:list returns active entries only in descending ID order", () => {
    const { vocabulary } = repo();
    const a = create(vocabulary, { lemma: "eerste" });
    const b = create(vocabulary, { lemma: "tweede" });
    create(vocabulary, { lemma: "derde", status: "stub" });
    expect(vocabulary.paginate({ cursor: 1, limit: 1 }).entries.map((entry) => entry.id)).toEqual([
      b.id,
    ]);
    expect(vocabulary.paginate({ cursor: 2, limit: 1 }).entries.map((entry) => entry.id)).toEqual([
      a.id,
    ]);
  });

  it("lists entries newest first, alphabetically, or by latest change", () => {
    const { database } = repo();
    let second = 0;
    const vocabulary = new SqliteVocabRepository(
      database,
      new StudyMemoryService(new StudyMemoryRepository(database)),
      {
        repositoryDeps: {
          nowIso: () => new Date(Date.UTC(2025, 0, 1, 0, 0, second++)).toISOString(),
        },
      },
    );
    const fiets = create(vocabulary, { lemma: "fiets" });
    create(vocabulary, { lemma: "appel" });
    create(vocabulary, { lemma: "boom" });
    const lemmas = (order: "added" | "alphabetical" | "modified") =>
      vocabulary.paginate({ order }).entries.map((entry) => entry.lemma);
    expect(lemmas("added")).toEqual(["boom", "appel", "fiets"]);
    expect(lemmas("alphabetical")).toEqual(["appel", "boom", "fiets"]);
    expect(lemmas("modified")).toEqual(["boom", "appel", "fiets"]);
    vocabulary.updateById(fiets.id, normalizeUpdateVocabEntryInput({ extra: "bicycle" }));
    expect(lemmas("modified")).toEqual(["fiets", "boom", "appel"]);
  });
});
