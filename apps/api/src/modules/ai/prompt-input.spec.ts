import { describe, expect, it } from "vite-plus/test";

import { promptInput } from "./prompt-input.js";

describe("promptInput", () => {
  it("sends only the term when no sense is given", () => {
    expect(promptInput({ term: "bank", excludeSenses: [] })).toBe("Input term: bank");
  });

  it("adds excluded and requested senses with whichever of cue and example they carry", () => {
    expect(
      promptInput({
        term: "bank",
        excludeSenses: [
          { senseCue: "geld" },
          { senseCue: "meubel", example: "Ik zit op de bank." },
          { example: "De bank van de rivier." },
        ],
        requestedSense: { senseCue: "zandbank" },
      }),
    ).toBe(
      [
        "Input term: bank",
        "",
        "Senses to exclude (do not return these senses):",
        "- senseCue: geld",
        "- senseCue: meubel; example: Ik zit op de bank.",
        "- example: De bank van de rivier.",
        "",
        "Requested sense (return only this sense):",
        "- senseCue: zandbank",
      ].join("\n"),
    );
  });
});
