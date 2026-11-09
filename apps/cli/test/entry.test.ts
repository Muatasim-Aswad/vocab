import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { main } from "../src/cli.ts";

describe("CLI package entrypoint", () => {
  it("prints help without contacting a server", async () => {
    const lines: string[] = [];
    expect(await main(["--help"], { write: (line) => lines.push(line) })).toBe(0);
    expect(lines[0]).toMatch(/^Usage: vocab \[--help \| --version\]/);
    expect(lines[0]).toContain("never starts a server");
  });

  it("prints the package version", async () => {
    const lines: string[] = [];
    expect(await main(["--version"], { write: (line) => lines.push(line) })).toBe(0);
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    expect(lines).toEqual([manifest.version]);
  });

  it("rejects unknown arguments with usage", async () => {
    const lines: string[] = [];
    expect(await main(["--token", "secret"], { write: (line) => lines.push(line) })).toBe(2);
    expect(lines[0]).toMatch(/^Usage:/);
  });
});
