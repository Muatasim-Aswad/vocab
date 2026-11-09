import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { generationSettings } from "../../src/modules/ai/generation-settings.ts";
import {
  type MatchCandidate,
  type MatchEntry,
  meaningMatchInput,
  meaningMatchResponseJsonSchema,
  meaningMatchSystemInstruction,
} from "../../src/modules/ai/meaning-match-prompt.ts";
import { checkMeaningMatch } from "../../src/modules/ai/meaning-match.ts";
import { type Generation, generate } from "../lib/gemini.ts";
import {
  apiKey,
  confirmPlan,
  outputDir,
  pool,
  commonOptions,
  roughTokens,
  writeJson,
} from "../lib/run.ts";
import { loadVariants } from "../lib/variants.ts";

interface Case {
  name: string;
  term: string;
  candidate: MatchCandidate;
  entries: MatchEntry[];
  expect: { decision: "same" | "new"; entryId?: number };
  notes?: string;
}

const caseFile = z.object({
  cases: z.array(
    z.object({
      name: z.string(),
      term: z.string(),
      candidate: z.looseObject({
        term: z.string(),
        senseCue: z.string().optional(),
        extra: z.string().optional(),
        partOfSpeech: z.string().optional(),
        examples: z.array(z.string()).optional(),
      }),
      entries: z.array(
        z.looseObject({
          id: z.number(),
          status: z.enum(["active", "stub"]),
          senseCue: z.string().optional(),
          partOfSpeech: z.string().optional(),
          extra: z.string().optional(),
          examples: z.array(z.string()).optional(),
          forms: z.array(z.string()).optional(),
          relations: z
            .array(
              z.looseObject({
                type: z.string(),
                term: z.string(),
                senseCue: z.string().optional(),
              }),
            )
            .optional(),
        }),
      ),
      expect: z.object({ decision: z.enum(["same", "new"]), entryId: z.number().optional() }),
      notes: z.string().optional(),
    }),
  ),
});

interface Outcome {
  variant: string;
  case: string;
  run: number;
  generation: Generation;
  decision?: string;
  entryId?: number;
  pass: boolean;
  issues: string[];
}

function judge(
  item: Case,
  generation: Generation,
): Pick<Outcome, "decision" | "entryId" | "pass" | "issues"> {
  if (!generation.ok) return { pass: false, issues: ["call failed"] };
  let payload: unknown;
  try {
    payload = JSON.parse(generation.text);
  } catch {
    return { pass: false, issues: ["invalid JSON"] };
  }
  const checked = checkMeaningMatch(payload, item.term, item.entries);
  if (!checked.ok) return { pass: false, issues: checked.issues };
  const { match } = checked;
  const entryId = match.decision === "same" ? match.entryId : undefined;
  const issues: string[] = [];
  if (match.decision !== item.expect.decision) issues.push(`decision ${match.decision}`);
  if (item.expect.entryId !== undefined && entryId !== item.expect.entryId)
    issues.push(`entry ${String(entryId)}`);
  return {
    decision: match.decision,
    ...(entryId !== undefined && { entryId }),
    pass: !issues.length,
    issues,
  };
}

const { values: args } = parseArgs({ options: commonOptions });

async function main() {
  const { cases: all } = caseFile.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "cases.json"), "utf8")),
  );
  const wanted = args.cases?.split(",").map((value) => value.trim());
  const cases = wanted ? all.filter((item) => wanted.includes(item.name)) : all;
  const runsPerCase = Number(args.runs);
  const variants = await loadVariants<Case>(args.variant, {
    model: args.model ?? process.env.VOCAB_GEMINI_MODEL,
    config: generationSettings,
    prompt: {
      systemInstruction: meaningMatchSystemInstruction,
      responseJsonSchema: meaningMatchResponseJsonSchema,
      input: (item) => meaningMatchInput(item.term, item.candidate, item.entries),
    },
  });
  await confirmPlan(
    variants.map((variant) => ({
      name: variant.name,
      model: variant.model,
      calls: cases.length * runsPerCase,
      inputTokens: roughTokens(variant.prompt.systemInstruction) + 200,
    })),
    [],
    args.yes,
  );
  const key = apiKey();
  const dir = outputDir("meaning-match", args.out);
  const jobs = variants.flatMap((variant) =>
    cases.flatMap((item) =>
      Array.from({ length: runsPerCase }, (_, i) => ({ variant, item, run: i + 1 })),
    ),
  );
  const outcomes = await pool(jobs, Number(args.concurrency), async ({ variant, item, run }) => {
    const generation = await generate({
      apiKey: key,
      model: variant.model,
      systemInstruction: variant.prompt.systemInstruction,
      contents: variant.prompt.input(item),
      responseJsonSchema: variant.prompt.responseJsonSchema,
      config: variant.config,
    });
    return {
      variant: variant.name,
      case: item.name,
      run,
      generation,
      ...judge(item, generation),
    } satisfies Outcome;
  });
  writeJson(dir, "runs.json", { variants, outcomes });

  const lines = [
    "# Meaning-match eval",
    "",
    "| Variant | Passed | Consistent cases | Failures |",
    "| --- | --- | --- | --- |",
  ];
  for (const variant of variants) {
    const mine = outcomes.filter((outcome) => outcome.variant === variant.name);
    const consistent = cases.filter(
      (item) =>
        new Set(mine.filter((o) => o.case === item.name).map((o) => `${o.decision}:${o.entryId}`))
          .size === 1,
    ).length;
    const failures = mine
      .filter((o) => !o.pass)
      .map((o) => `${o.case}#${o.run}: ${o.issues.join(", ")}`);
    lines.push(
      `| ${variant.name} (${variant.model}) | ${mine.filter((o) => o.pass).length}/${mine.length} | ${consistent}/${cases.length} | ${failures.join("<br>") || "–"} |`,
    );
  }
  writeFileSync(join(dir, "report.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

await main();
