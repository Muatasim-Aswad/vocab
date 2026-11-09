import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { cursorPage } from "./pagination.ts";

const page = cursorPage(z.object({ id: z.int() }));

describe("cursorPage", () => {
  it("accepts a middle page and the last page", () => {
    expect(
      page.parse({ items: [{ id: 1 }], metadata: { next_cursor: "c2" } }).metadata.next_cursor,
    ).toBe("c2");
    expect(
      page.parse({ items: [], metadata: { next_cursor: null } }).metadata.next_cursor,
    ).toBeNull();
  });

  it("requires next_cursor and validates items", () => {
    expect(page.safeParse({ items: [], metadata: {} }).success).toBe(false);
    expect(page.safeParse({ items: [{ id: "1" }], metadata: { next_cursor: null } }).success).toBe(
      false,
    );
  });
});
