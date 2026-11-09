import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("hook runs the pinned gate and preserves the index", () => {
  const dir = mkdtempSync(join(tmpdir(), "vocab-hook-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, "file"), "staged\n");
    execFileSync("git", ["add", "file"], { cwd: dir });
    writeFileSync(join(dir, "file"), "unstaged\n");
    const before = execFileSync("git", ["show", ":file"], { cwd: dir });
    const hook = join(dir, "hook");
    copyFileSync(resolve(import.meta.dirname, "../../.githooks/pre-commit"), hook);
    const fakeMise = join(dir, "mise");
    writeFileSync(
      fakeMise,
      '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_RESULT"\nexit "${HOOK_EXIT:-0}"\n',
    );
    chmodSync(fakeMise, 0o755);
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      HOOK_RESULT: join(dir, "result"),
    };
    assert.equal(spawnSync(hook, { cwd: dir, env }).status, 0);
    assert.equal(readFileSync(env.HOOK_RESULT, "utf8"), "run check\n");
    assert.deepEqual(execFileSync("git", ["show", ":file"], { cwd: dir }), before);
    assert.equal(spawnSync(hook, { cwd: dir, env: { ...env, HOOK_EXIT: "7" } }).status, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
