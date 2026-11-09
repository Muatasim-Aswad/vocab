import { describe, expect, it } from "vite-plus/test";

import { entryId, utcTimestamp, uuidV7 } from "./primitives.ts";

describe("entryId", () => {
  it.each([1, 42, Number.MAX_SAFE_INTEGER])("accepts existing integer ID %s", (value) => {
    expect(entryId.parse(value)).toBe(value);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    "0190a6d2-8b4e-7c3a-9f1d-2b3c4d5e6f70",
    null,
  ])("rejects %s", (value) => {
    expect(entryId.safeParse(value).success).toBe(false);
  });
});

describe("uuidV7", () => {
  it("accepts a UUIDv7", () => {
    expect(uuidV7.parse("0190a6d2-8b4e-7c3a-9f1d-2b3c4d5e6f70")).toBe(
      "0190a6d2-8b4e-7c3a-9f1d-2b3c4d5e6f70",
    );
  });

  it.each(["3b241101-e2bb-4255-8caf-4136c566a962", "not-a-uuid", 1])("rejects %s", (value) => {
    expect(uuidV7.safeParse(value).success).toBe(false);
  });
});

describe("utcTimestamp", () => {
  it.each(["2026-09-27T18:00:00Z", "2026-09-27T18:00:00.123Z"])("accepts UTC %s", (value) => {
    expect(utcTimestamp.parse(value)).toBe(value);
  });

  it.each(["2026-09-27T20:00:00+02:00", "2026-09-27T18:00:00", "2026-09-27", 1_790_000_000_000])(
    "rejects non-UTC or non-ISO %s",
    (value) => {
      expect(utcTimestamp.safeParse(value).success).toBe(false);
    },
  );
});
