import { createApiClient } from "@vocab/api-client";

import { uuidV7 } from "../../src/shared/uuid.ts";

/** Fixed, non-secret token for disposable servers. */
export const e2eToken = "e2e-fixture-token-not-a-secret-0123456789";

type EntryInput = Parameters<ReturnType<typeof createApiClient>["createEntry"]>[0]["entry"];

/** Werk- compounds: more than one 20-entry page for one prefix. */
export const werkWords = [
  "werkdag",
  "werkgever",
  "werknemer",
  "werkplaats",
  "werktuig",
  "werkkamer",
  "werkweek",
  "werkboek",
  "werkgroep",
  "werklust",
  "werkloos",
  "werkplek",
  "werkschoen",
  "werkstuk",
  "werktijd",
  "werkvloer",
  "werkwijze",
  "werkzaam",
  "werkruimte",
  "werkdruk",
  "werkkracht",
  "werkplan",
  "werkgeheugen",
];

/**
 * Legacy-shaped vocabulary: homonyms with meaning labels, forms, typed relations that create
 * stubs, articles, reflexive verbs, phrases, examples, collocations, and a long compound.
 */
const entries: EntryInput[] = [
  {
    lemma: "de bank",
    senseCue: "geld",
    extra: "Place that keeps money",
    partOfSpeech: "NOUN",
    forms: ["banken"],
    examples: ["Ik breng geld naar de bank."],
  },
  {
    lemma: "de bank",
    senseCue: "zitmeubel",
    extra: "Long seat for several people",
    partOfSpeech: "NOUN",
    forms: ["banken"],
  },
  {
    lemma: "lopen",
    extra: "to walk",
    partOfSpeech: "VERB",
    forms: ["loop", "loopt", "liep", "liepen", "gelopen"],
    examples: ["Wij lopen naar huis."],
    relatedTokens: ["+wandelen", "~de loop"],
  },
  {
    lemma: "het huis",
    extra: "house",
    partOfSpeech: "NOUN",
    forms: ["huizen"],
    examples: ["Het huis is groot."],
    collocations: ["thuis komen"],
  },
  { lemma: "zich vergissen", extra: "to be mistaken", partOfSpeech: "VERB" },
  { lemma: "op de hoogte", extra: "informed", examples: ["Ik ben op de hoogte."] },
  {
    lemma: "de arbeidsongeschiktheidsverzekering",
    extra:
      "Disability insurance. Kept deliberately long, with a lengthy note, so layouts must wrap arbeidsongeschiktheidsverzekeringsmaatschappij without horizontal scrolling.",
    partOfSpeech: "NOUN",
  },
  { lemma: "de band", extra: "tyre or music group" },
  { lemma: "de bal", extra: "ball or dance party" },
  ...werkWords.map((lemma) => ({ lemma, partOfSpeech: "NOUN" })),
];

export async function seed(baseUrl: string) {
  const api = createApiClient({ baseUrl });
  for (const entry of entries)
    await api.createEntry(
      { mutationId: uuidV7(), entry, senseCueBackfills: [] },
      { token: e2eToken },
    );
}
