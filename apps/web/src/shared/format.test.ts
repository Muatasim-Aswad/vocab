import { describe, expect, it } from "vite-plus/test";

import { formatDateTime, formatDecimal } from "./format.ts";

describe("display formatting", () => {
  it("uses the resolved system time zone by default and supports an explicit zone", () => {
    const value = new Date("2024-01-02T10:00:00Z");
    const options = { dateStyle: "medium", timeStyle: "short" } as const;
    expect(formatDateTime(value, "en", options)).toBe(
      new Intl.DateTimeFormat("en", options).format(value),
    );
    expect(formatDateTime(value, "nl", options, "UTC")).toBe(
      new Intl.DateTimeFormat("nl", { ...options, timeZone: "UTC" }).format(value),
    );
  });

  it("formats decimals with the requested locale", () => {
    expect(formatDecimal(12.34, "en", 1)).toBe("12.3");
    expect(formatDecimal(12.34, "nl", 1)).toBe("12,3");
  });
});
