import { describe, expect, it } from "vite-plus/test";

import { createI18n } from "./i18n.ts";

function leaves(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value === "string") result.set(prefix, value);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      for (const [path, text] of leaves(child, prefix ? `${prefix}.${key}` : key))
        result.set(path, text);
  return result;
}

const params = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1]!)
    .toSorted((a, b) => a.localeCompare(b));

describe("message catalogs", () => {
  it("cover the same keys and interpolation parameters in English and Dutch", () => {
    const en = leaves(createI18n("en").getResourceBundle("en", "translation"));
    const nl = leaves(createI18n("nl").getResourceBundle("nl", "translation"));
    expect([...nl.keys()].toSorted()).toEqual([...en.keys()].toSorted());
    for (const [key, text] of en) {
      expect(nl.get(key)!.trim(), key).not.toBe("");
      expect(params(nl.get(key)!), key).toEqual(params(text));
    }
    expect(en.size).toBeGreaterThan(200);
  });

  it("uses locale plural rules and named parameters", () => {
    const en = createI18n("en");
    const nl = createI18n("nl");
    expect(en.t("vocab.search.found", { count: 1 })).toBe("1 result");
    expect(en.t("vocab.search.found", { count: 3 })).toBe("3 results");
    expect(nl.t("vocab.search.found", { count: 1 })).toBe("1 resultaat");
    expect(nl.t("vocab.search.found", { count: 3 })).toBe("3 resultaten");
    expect(nl.t("vocab.search.capturesStartingWith", { prefix: "fie" })).toBe(
      "Bewaarde termen die beginnen met ‘fie’",
    );
  });
});
