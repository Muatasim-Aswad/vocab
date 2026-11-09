import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadVariants } from "../evals/lib/variants.ts";
import { tempDir } from "./support.js";

describe("eval variants", () => {
  it("keeps omitted prompt defaults while validating a partial override", async () => {
    const dir = tempDir();
    try {
      const path = join(dir.dir, "variant.mjs");
      writeFileSync(
        path,
        'export default { name: "partial", prompt: { input: (text) => `variant:${text}` } };',
      );
      const [variant] = await loadVariants<string>([path], {
        model: "test-model",
        config: { temperature: 0 },
        prompt: {
          systemInstruction: "default",
          responseJsonSchema: { type: "object" },
          input: (text) => text,
        },
      });
      expect(variant?.prompt.systemInstruction).toBe("default");
      expect(variant?.prompt.responseJsonSchema).toEqual({ type: "object" });
      expect(variant?.prompt.input("word")).toBe("variant:word");
    } finally {
      dir.cleanup();
    }
  });
});
