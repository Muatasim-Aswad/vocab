import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

function repository(run) {
  const root = mkdtempSync(join(tmpdir(), "vocab-scan-range-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(join(root, "bin"));
    copyFileSync(new URL("./scan-range.mjs", import.meta.url), join(root, "scan-range.mjs"));
    writeFileSync(
      join(root, "bin/gitleaks"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$SCAN_ARGS_FILE"\n',
      {
        mode: 0o755,
      },
    );
    git("init", "-q");
    git("config", "user.name", "Synthetic fixture");
    git("config", "user.email", "fixture@example.invalid");
    const commit = (content) => {
      writeFileSync(join(root, "source.txt"), content);
      git("add", "source.txt");
      git("-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic fixture");
      return git("rev-parse", "HEAD");
    };
    const before = commit("before");
    const after = commit("after");
    const scan = (base) => {
      const result = spawnSync(process.execPath, ["scan-range.mjs"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}${delimiter}${process.env.PATH}`,
          SCAN_BEFORE: base,
          SCAN_AFTER: after,
          SCAN_ARGS_FILE: join(root, "scan-args"),
        },
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(join(root, "scan-args"), "utf8").trim().split("\n").at(-1);
    };
    run({ git, before, after, scan });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("push scans use the range when the previous commit is an ancestor", () => {
  repository(({ before, after, scan }) => {
    assert.equal(scan(before), `--log-opts=${before}..${after}`);
  });
});

void test("first pushes and missing amended-away commits scan current history", () => {
  repository(({ after, scan }) => {
    for (const before of ["0".repeat(40), "f".repeat(40)]) {
      assert.equal(scan(before), `--log-opts=${after}`);
    }
  });
});

void test("unrelated previous commits scan current history", () => {
  repository(({ git, before, after, scan }) => {
    git("checkout", "--orphan", "unrelated");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "Unrelated fixture");
    const unrelated = git("rev-parse", "HEAD");
    assert.notEqual(unrelated, before);
    assert.equal(scan(unrelated), `--log-opts=${after}`);
  });
});
