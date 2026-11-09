import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "vocab-public-source-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const manifest = { name: "fixture", version: "0.1.0", license: "MIT" };
  const write = (path, value) => writeFileSync(join(root, path), JSON.stringify(value));
  const check = (...args) =>
    spawnSync(process.execPath, ["scripts/publication/check.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    for (const dir of ["scripts/publication", "apps/fixture", "packages"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    copyFileSync(
      new URL("./check.mjs", import.meta.url),
      join(root, "scripts/publication/check.mjs"),
    );
    write("package.json", manifest);
    write("apps/fixture/package.json", manifest);
    writeFileSync(join(root, "scripts/publication/source-inventory.txt"), "");
    git("init", "-q");
    git("add", ".");
    assert.equal(check("--write-inventory").status, 0);
    run({ root, git, write, check, manifest });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("source gate accepts the reviewed inventory and rejects an added tracked file", () => {
  fixture(({ root, git, check }) => {
    assert.equal(check().status, 0);
    writeFileSync(join(root, "extra.txt"), "unreviewed");
    git("add", "extra.txt");
    const result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Tracked source inventory changed/);
  });
});

void test("updating the allowlist cannot admit local configuration", () => {
  fixture(({ root, git, check }) => {
    writeFileSync(join(root, ".env"), "TOKEN=synthetic\n");
    git("add", ".env");
    const result = check("--write-inventory");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Private or generated tracked path/);
  });
});

void test("root version changes require synchronization and workspaces require MIT", () => {
  fixture(({ write, check, manifest }) => {
    write("package.json", { ...manifest, version: "0.2.0" });
    assert.match(check().stderr, /Version drift/);
    assert.equal(check("--sync-version").status, 0);
    assert.equal(check().status, 0);
    write("apps/fixture/package.json", { ...manifest, version: "0.2.0", license: "other" });
    assert.match(check().stderr, /Missing MIT declaration/);
  });
});
