import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const lemma = z.object({
  id: z.string(),
  terms: z.array(z.string()).min(1),
  partOfSpeech: z.string(),
  separable: z.boolean().optional(),
  irregular: z.boolean().optional(),
  forms: z.object({ required: z.array(z.string()), optional: z.array(z.string()) }),
});

const sense = z.object({
  id: z.string(),
  lemma: z.string(),
  /** essential: omitting it is a defect; valid: attested, optional; uncertain: unverified. */
  tier: z.enum(["essential", "valid", "uncertain"]),
  gloss: z.string(),
  example: z.string(),
});

const testCase = z.object({
  input: z.string(),
  covers: z.array(z.string()),
  lemmas: z.array(lemma).min(1),
  senses: z.array(sense).min(1),
  notes: z.string().optional(),
  sources: z.array(z.string()),
});

const file = z.object({ asOf: z.string(), method: z.string(), cases: z.array(testCase) });

export type Lemma = z.infer<typeof lemma>;
export type Case = z.infer<typeof testCase>;

export function loadCases(only: string | undefined): Case[] {
  const { cases } = file.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "cases.json"), "utf8")),
  );
  if (!only) return cases;
  const wanted = new Set(only.split(",").map((value) => value.trim()));
  const picked = cases.filter((item) => wanted.has(item.input));
  const unknown = [...wanted].filter((input) => !picked.some((item) => item.input === input));
  if (unknown.length) throw new Error(`Unknown cases: ${unknown.join(", ")}`);
  return picked;
}
