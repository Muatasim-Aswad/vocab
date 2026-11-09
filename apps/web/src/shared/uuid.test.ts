import { describe, expect, it } from "vite-plus/test";

import { uuidV7 as generate } from "./uuid.ts";

describe("uuidV7", () => {
  it("produces contract-valid, time-ordered, unique identities", () => {
    const first = generate(1_700_000_000_000);
    const second = generate(1_700_000_000_001);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.slice(0, 13)).toBe("018bcfe5-6800");
    expect(first < second).toBe(true);
    expect(new Set(Array.from({ length: 100 }, () => generate())).size).toBe(100);
  });
});
