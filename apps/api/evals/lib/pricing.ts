import type { Usage } from "./gemini.ts";

/** Paid-tier USD per million tokens (input, output incl. thinking) from ai.google.dev/pricing. */
const prices: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
export const pricesAsOf = "2026-10-02";

export function cost(model: string, usage: Usage): number | undefined {
  const price = prices[model];
  if (!price) return undefined;
  return (usage.input * price.input + (usage.output + usage.thinking) * price.output) / 1e6;
}

/** Upper estimate for planning: thinking models can write well over a thousand tokens per call. */
export function estimate(model: string, inputTokens: number, calls: number): number | undefined {
  const each = cost(model, { input: inputTokens, output: 1000, thinking: 1500 });
  return each === undefined ? undefined : each * calls;
}
