import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Asks the machine's `local-agent` command (outside this repo) for a schema-valid JSON answer.
 * The command owns which CLI and model an agent name means, and isolates each request.
 */
export async function askAgent(
  agent: string,
  prompt: string,
  schema: Record<string, unknown>,
): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "vocab-eval-"));
  const schemaPath = join(dir, "schema.json");
  writeFileSync(schemaPath, JSON.stringify(schema));
  try {
    const stdout = await new Promise<string>((done, fail) => {
      const child = spawn("local-agent", [
        "--agent",
        agent,
        "--effort",
        "high",
        "--schema",
        schemaPath,
      ]);
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      child.on("error", fail);
      child.on("close", (code) =>
        code === 0 ? done(out) : fail(new Error(`local-agent exited ${code}: ${err.slice(-500)}`)),
      );
      child.stdin.end(prompt);
    });
    return JSON.parse(stdout) as unknown;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
