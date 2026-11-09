import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { generationSettings } from "../../src/modules/ai/generation-settings.ts";
import {
  oneWordResponseJsonSchema,
  oneWordSystemInstruction,
} from "../../src/modules/ai/one-word-prompt.ts";
import { promptInput } from "../../src/modules/ai/prompt-input.ts";
import { generate } from "../lib/gemini.ts";
import { askAgent } from "../lib/local-agent.ts";
import {
  apiKey,
  commonOptions,
  confirmPlan,
  outputDir,
  pool,
  roughTokens,
  writeJson,
} from "../lib/run.ts";
import { loadVariants } from "../lib/variants.ts";
import { type Case, loadCases } from "./cases.ts";
import { checkRun } from "./checks.ts";
import { type Blind, type Grade, gradeSchema, gradingPrompt } from "./grading.ts";
import { type CaseGrade, report, type RunRecord } from "./report.ts";

const { values: args } = parseArgs({
  options: {
    ...commonOptions,
    grader: { type: "string", default: "sol" },
    regrade: { type: "string" },
  },
});

const attempt = z.looseObject({
  ms: z.number(),
  status: z.number().optional(),
  error: z.string().optional(),
});
const savedRuns = z.object({
  variants: z.array(z.object({ name: z.string(), model: z.string() })),
  runs: z.array(
    z.object({
      variant: z.string(),
      model: z.string(),
      input: z.string(),
      run: z.number(),
      generation: z.discriminatedUnion("ok", [
        z.looseObject({
          ok: z.literal(true),
          text: z.string(),
          usage: z.looseObject({ input: z.number(), output: z.number(), thinking: z.number() }),
          modelVersion: z.string().optional(),
          attempts: z.array(attempt),
        }),
        z.looseObject({ ok: z.literal(false), error: z.string(), attempts: z.array(attempt) }),
      ]),
      checks: z
        .object({
          parsed: z.boolean(),
          senseCount: z.number(),
          essentialCount: z.number(),
          senses: z.array(
            z.object({
              index: z.number(),
              term: z.string(),
              termKnown: z.boolean(),
              correctedOk: z.boolean(),
              partOfSpeechOk: z.boolean(),
              forms: z
                .object({
                  lemma: z.string(),
                  missing: z.array(z.string()),
                  unexpected: z.array(z.string()),
                })
                .nullable(),
              flagIssues: z.array(z.string()),
              exampleUsesWord: z.boolean(),
            }),
          ),
          issues: z.array(z.string()),
        })
        .optional(),
    }),
  ),
});

const gradeResult = z.fromJSONSchema(gradeSchema);

function isGrade(value: unknown): value is Grade {
  return gradeResult.safeParse(value).success;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

async function grade(item: Case, records: RunRecord[], agent: string): Promise<CaseGrade> {
  const blinds: Blind[] = [];
  const key: Record<string, string> = {};
  for (const record of shuffle(records)) {
    if (!record.generation.ok || !record.checks) continue;
    const label = `Output ${blinds.length + 1}`;
    key[label] = `${record.variant}#${record.run}`;
    blinds.push({ label, output: JSON.parse(record.generation.text), checks: record.checks });
  }
  if (!blinds.length) return { input: item.input, agent, key, error: "no successful outputs" };
  try {
    const answer = await askAgent(agent, gradingPrompt(item, blinds), gradeSchema);
    if (!isGrade(answer)) throw new Error("Grader returned an invalid result");
    return { input: item.input, agent, key, grade: answer };
  } catch (error) {
    return {
      input: item.input,
      agent,
      key,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function gradeAll(dir: string, cases: Case[], runs: RunRecord[], agent: string) {
  if (agent === "none") return [];
  console.log(`Grading ${cases.length} words with ${agent}…`);
  const grades = await pool(cases, 2, (item) =>
    grade(
      item,
      runs.filter((run) => run.input === item.input),
      agent,
    ),
  );
  writeJson(dir, `grades-${agent}.json`, grades);
  return grades;
}

function checked(cases: Case[], record: RunRecord): RunRecord {
  const item = cases.find((candidate) => candidate.input === record.input);
  if (!item || !record.generation.ok) return record;
  return { ...record, checks: checkRun(item, record.generation.text) };
}

async function regrade(cases: Case[], from: string, agent: string) {
  const dir = resolve(from);
  const saved = savedRuns.parse(JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")));
  const runs = saved.runs
    .filter((run) => cases.some((item) => item.input === run.input))
    .map((run) => checked(cases, run));
  const grades = await gradeAll(dir, cases, runs, agent);
  const file = join(dir, `report-${agent}.md`);
  writeFileSync(file, report(cases, saved.variants, runs, grades));
  console.log(`Report: ${file}`);
}

async function main() {
  const cases = loadCases(args.cases);
  if (args.regrade) return regrade(cases, args.regrade, args.grader);

  const runsPerCase = Number(args.runs);
  const variants = await loadVariants<string>(args.variant, {
    model: args.model ?? process.env.VOCAB_GEMINI_MODEL,
    config: generationSettings,
    prompt: {
      systemInstruction: oneWordSystemInstruction,
      responseJsonSchema: oneWordResponseJsonSchema,
      input: (term) => promptInput({ term }),
    },
  });
  await confirmPlan(
    variants.map((variant) => ({
      name: variant.name,
      model: variant.model,
      calls: cases.length * runsPerCase,
      inputTokens: roughTokens(variant.prompt.systemInstruction) + 20,
    })),
    args.grader === "none" ? [] : [`Grader ${args.grader}: ${cases.length} calls via local-agent`],
    args.yes,
  );
  const key = apiKey();
  const dir = outputDir("one-word", args.out);
  const jobs = variants.flatMap((variant) =>
    cases.flatMap((item) =>
      Array.from({ length: runsPerCase }, (_, index) => ({ variant, item, run: index + 1 })),
    ),
  );
  let done = 0;
  const runs = await pool(jobs, Number(args.concurrency), async ({ variant, item, run }) => {
    const generation = await generate({
      apiKey: key,
      model: variant.model,
      systemInstruction: variant.prompt.systemInstruction,
      contents: variant.prompt.input(item.input),
      responseJsonSchema: variant.prompt.responseJsonSchema,
      config: variant.config,
    });
    done++;
    console.log(
      `  ${done}/${jobs.length} ${variant.name} ${item.input}#${run}: ${generation.ok ? "ok" : generation.error}`,
    );
    return checked(cases, {
      variant: variant.name,
      model: variant.model,
      input: item.input,
      run,
      generation,
    });
  });
  writeJson(dir, "runs.json", { variants, runs });
  const grades = await gradeAll(dir, cases, runs, args.grader);
  const file = join(dir, args.grader === "none" ? "report.md" : `report-${args.grader}.md`);
  writeFileSync(file, report(cases, variants, runs, grades));
  console.log(`Report: ${file}`);
}

await main();
