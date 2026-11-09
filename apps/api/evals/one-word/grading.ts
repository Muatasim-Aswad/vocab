import type { Case } from "./cases.ts";
import type { RunCheck } from "./checks.ts";

/** One generated answer as the grader sees it: a blind label, the output and its checks. */
export interface Blind {
  label: string;
  output: unknown;
  checks: RunCheck;
}

type JsonSchema = z.core.JSONSchema.JSONSchema;

const strictObject = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text: JsonSchema = { type: "string" };
const note: JsonSchema = { type: ["string", "null"] };
const flag: JsonSchema = { type: "boolean" };
const issues = (key: string): JsonSchema => ({
  type: "array",
  items: strictObject({ [key]: text, issue: text }),
});

/** Every verdict is a yes/no, a choice or a list with quoted evidence; nothing is a score. */
export const gradeSchema = strictObject({
  outputs: {
    type: "array",
    items: strictObject({
      label: text,
      reference_coverage: {
        type: "array",
        items: strictObject({
          reference_sense: text,
          status: { type: "string", enum: ["covered", "blended", "missing"] },
          output_senses: { type: "array", items: { type: "integer" } },
          evidence: text,
        }),
      },
      output_senses: {
        type: "array",
        items: strictObject({
          index: { type: "integer" },
          verdict: {
            type: "string",
            enum: ["reference", "valid_unlisted", "duplicate", "invalid"],
          },
          reference_senses: { type: "array", items: text },
          duplicate_of: { type: ["integer", "null"] },
          evidence: text,
          term_ok: flag,
          term_issue: note,
          example_ok: flag,
          example_issue: note,
          gloss_ok: flag,
          gloss_issue: note,
          label_ok: flag,
          label_issue: note,
          forms_fit: flag,
          forms_issue: note,
          relation_issues: issues("term"),
          collocation_issues: issues("text"),
        }),
      },
      summary: text,
    }),
  },
  reference_issues: { type: "array", items: text },
  comparison: text,
});

export interface Grade {
  outputs: Array<{
    label: string;
    reference_coverage: Array<{
      reference_sense: string;
      status: "covered" | "blended" | "missing";
      output_senses: number[];
      evidence: string;
    }>;
    output_senses: Array<{
      index: number;
      verdict: "reference" | "valid_unlisted" | "duplicate" | "invalid";
      reference_senses: string[];
      duplicate_of: number | null;
      evidence: string;
      term_ok: boolean;
      term_issue: string | null;
      example_ok: boolean;
      example_issue: string | null;
      gloss_ok: boolean;
      gloss_issue: string | null;
      label_ok: boolean;
      label_issue: string | null;
      forms_fit: boolean;
      forms_issue: string | null;
      relation_issues: Array<{ term: string; issue: string }>;
      collocation_issues: Array<{ text: string; issue: string }>;
    }>;
    summary: string;
  }>;
  reference_issues: string[];
  comparison: string;
}

export function gradingPrompt(item: Case, blinds: Blind[]): string {
  const reference = {
    input: item.input,
    lemmas: item.lemmas,
    senses: item.senses,
    ...(item.notes && { notes: item.notes }),
    sources: item.sources,
  };
  return `You check AI-generated Dutch vocabulary entries for English-speaking B1-B2 learners against a source-backed reference. Do not score or rank. Answer each check from the evidence and quote the output when you judge it.

The app asked a model to turn one Dutch input into a JSON array with one object per distinct sense. Fields: term (lemma; de/het for nouns; zich only when the sense is reflexive), corrected (term differs from the input), senseCue (one-word Dutch label telling senses apart without giving the meaning away; only required when the output has several senses), examples (natural modern Dutch that makes the meaning clear), relations ({type, term}: synonym near-substitutable, antonym, wordFamily derivation, posVariation, related), collocations (frequent fixed combinations), partOfSpeech, forms, flags, extra (concise English meaning plus word parts or hints).

Reference (tiers: essential = a learner needs it, so leaving it out is a defect; valid = attested, fine either way; uncertain = unverified, never count it against an output):
${JSON.stringify(reference, null, 2)}

Outputs to check, each with automatic check results (forms compared as sets against each reference lemma; exampleUsesWord = every example contains the word or one of its forms):
${blinds.map((blind) => `--- ${blind.label} ---\n${JSON.stringify({ output: blind.output, checks: blind.checks }, null, 2)}`).join("\n")}

For every output, by meaning, never by label or wording:
1. reference_coverage: one row per reference sense. covered = one output sense means it; blended = an output sense mixes it with another reference sense; missing = no output sense means it. List the output sense indexes.
2. output_senses: one row per output sense. verdict: reference (matches reference senses, listed), valid_unlisted (a real meaning the reference lacks; also add it to reference_issues), duplicate (same meaning as an earlier output sense, give duplicate_of), invalid (not a real meaning of the word). Then the yes/no checks with a short issue when no: term (lemma, article, zich), example, gloss (extra), label (senseCue; a missing label is fine when the output has one sense), forms_fit (forms and separable/irregular flags fit this sense; use the automatic results), and list concrete problems in relations and collocations (empty when none).
3. summary: one sentence.
Then reference_issues (anything the reference gets wrong or lacks) and comparison (one or two sentences on how the outputs differ).`;
}
import type { z } from "zod";
