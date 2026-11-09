import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ParseArgsOptionsConfig } from "node:util";

import { estimate } from "./pricing.ts";

/** Options every eval accepts; each `main.ts` adds its own to `parseArgs`. */
export const commonOptions = {
  variant: { type: "string", multiple: true, default: [] },
  model: { type: "string" },
  runs: { type: "string", default: "2" },
  cases: { type: "string" },
  concurrency: { type: "string", default: "4" },
  out: { type: "string" },
  yes: { type: "boolean", default: false },
} as const satisfies ParseArgsOptionsConfig;

export function apiKey(): string {
  const key = process.env.VOCAB_GEMINI_API_KEY;
  if (!key) throw new Error("Set VOCAB_GEMINI_API_KEY in the root .env or environment");
  return key;
}

export function outputDir(evalName: string, out: string | undefined): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const dir = resolve(out ?? join(import.meta.dirname, "..", "results", `${stamp}-${evalName}`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

export interface PlanRow {
  name: string;
  model: string;
  calls: number;
  inputTokens: number;
}

/** Prints the planned calls and their upper cost estimate, then asks unless `--yes`. */
export async function confirmPlan(rows: PlanRow[], notes: string[], yes: boolean): Promise<void> {
  console.log("Plan:");
  let total = 0;
  for (const row of rows) {
    const price = estimate(row.model, row.inputTokens, row.calls);
    total += price ?? 0;
    const shown = price === undefined ? "unknown price" : `≤ $${price.toFixed(2)}`;
    console.log(`  ${row.name}: ${row.model}, ${row.calls} calls, ${shown}`);
  }
  for (const note of notes) console.log(`  ${note}`);
  console.log(`  Gemini total ≤ $${total.toFixed(2)} (upper estimate; retries cost extra)`);
  if (yes) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Proceed? [y/N] ");
  prompt.close();
  if (answer.trim().toLowerCase() !== "y") throw new Error("Cancelled");
}

/** Runs tasks with at most `limit` in flight, keeping input order in the results. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const roughTokens = (text: string) => Math.ceil(text.length / 4);
