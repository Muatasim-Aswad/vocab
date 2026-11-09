import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const inventory: unknown = JSON.parse(
  readFileSync(new URL("./coverage-cases.json", import.meta.url), "utf8"),
);

function isCase(value: unknown): value is { id: string; test: string; case: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "test" in value &&
    typeof value.test === "string" &&
    "case" in value &&
    typeof value.case === "string"
  );
}

assert(Array.isArray(inventory) && inventory.length > 0 && inventory.every(isCase));

describe("CLI behavior coverage", () => {
  it("gives each supported behavior a unique identifier", () => {
    expect(new Set(inventory.map((item) => item.id)).size).toBe(inventory.length);
  });

  it("names acceptance cases that exist in the CLI test sources", () => {
    const sources = new Map<string, string>();
    for (const item of inventory) {
      if (!sources.has(item.test)) {
        const file = new URL(`../../../${item.test}`, import.meta.url);
        sources.set(item.test, readFileSync(file, "utf8"));
      }
      expect(sources.get(item.test)!.includes(`it("${item.case}"`), item.case).toBe(true);
    }
  });
});
