import { describe, expect, it } from "vite-plus/test";

import { separablePart } from "./separablePart.js";

describe("separablePart", () => {
  it("reads the particle from split finite forms", () => {
    expect(separablePart("opstaan", ["sta op", "stond op", "stonden op", "opgestaan"])).toBe("op");
    expect(separablePart("aankleden", ["kleedde zich aan", "aangekleed"])).toBe("aan");
    expect(separablePart("achteruitgaan", ["ging achteruit", "achteruitgegaan"])).toBe("achteruit");
  });

  it("finds particles missing from any prefix list", () => {
    expect(separablePart("schoonmaken", ["maakte schoon", "schoongemaakt"])).toBe("schoon");
    expect(separablePart("gelukwensen", ["wenste geluk"])).toBe("geluk");
  });

  it("ignores auxiliaries and other words that are not a lemma prefix", () => {
    expect(separablePart("opstaan", ["is opgestaan", "stond op"])).toBe("op");
    expect(separablePart("opstaan", ["is opgestaan"])).toBeUndefined();
  });

  it("omits the particle when forms are missing, unsplit or disagree", () => {
    expect(separablePart("opstaan", undefined)).toBeUndefined();
    expect(separablePart("opstaan", [])).toBeUndefined();
    expect(separablePart("voorkomen", ["voorkwam", "voorkomen"])).toBeUndefined();
    expect(separablePart("achteruitgaan", ["ging achteruit", "gaat achter"])).toBeUndefined();
  });

  it("does not split multi-word lemmas or the whole lemma", () => {
    expect(separablePart("zich aankleden", ["kleedde zich aan"])).toBeUndefined();
    expect(separablePart("op", ["zet het op"])).toBeUndefined();
  });

  it("compares case-insensitively and returns the lowercase particle", () => {
    expect(separablePart("Opstaan", ["Stond Op"])).toBe("op");
  });
});
