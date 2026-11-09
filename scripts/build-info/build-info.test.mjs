import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const vp = join(root, "node_modules/.bin/vp");
const plugin = join(root, "apps/web/build-info.ts");

function run(cwd, command, args, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: "pipe",
  }).trim();
}

void test("build output identifies clean and dirty sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "vocab-build-info-"));
  try {
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, ".gitignore"), "node_modules\ndist\n");
    writeFileSync(join(dir, "package.json"), '{"type":"module","version":"1.2.3"}');
    writeFileSync(join(dir, "index.html"), "<script type=module src=/main.js></script>");
    writeFileSync(join(dir, "main.js"), "console.log('fixture')");
    writeFileSync(
      join(dir, "vite.config.ts"),
      `import { buildInfo } from ${JSON.stringify(plugin)};\nexport default { plugins: [buildInfo()], run: { tasks: { build: { command: "vp build", cache: false } } } };\n`,
    );
    run(dir, "git", ["init", "-q"]);
    run(dir, "git", ["add", "."]);
    run(dir, "git", [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    const revision = run(dir, "git", ["rev-parse", "HEAD"]);
    const build = (env = {}) => {
      run(dir, vp, ["run", "build"], {
        APP_REVISION: "",
        APP_COMMIT_TIME: "",
        APP_BUILD_TIME: "",
        ...env,
      });
      return JSON.parse(readFileSync(join(dir, "dist/version.json"), "utf8"));
    };
    assert.equal(build().revision, revision);
    writeFileSync(join(dir, "main.js"), "console.log('changed')");
    assert.equal(build().revision, "dev");
    run(dir, "git", ["checkout", "--", "main.js"]);
    writeFileSync(join(dir, "new-source.js"), "export default 1");
    assert.equal(build().revision, "dev");
    run(dir, "git", ["add", "new-source.js"]);
    run(dir, "git", [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "second",
    ]);
    const nextRevision = run(dir, "git", ["rev-parse", "HEAD"]);
    assert.notEqual(nextRevision, revision);
    assert.equal(build().revision, nextRevision);
    writeFileSync(join(dir, "new-source.js"), "export default 2");
    assert.equal(build({ APP_REVISION: revision }).revision, "dev");
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    assert.equal(build().revision, "dev");
    const explicit = build({
      APP_REVISION: revision,
      APP_COMMIT_TIME: "2026-01-01T00:00:00Z",
      APP_BUILD_TIME: "2026-01-02T00:00:00Z",
    });
    assert.equal(explicit.revision, revision);
    assert.equal(explicit.committedAt, "2026-01-01T00:00:00Z");
    assert.equal(explicit.builtAt, "2026-01-02T00:00:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("the real web task rebuilds identity across commits and edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "vocab-web-task-"));
  const web = join(root, "apps/web");
  const fixtureWeb = join(dir, "apps/web");
  try {
    mkdirSync(fixtureWeb, { recursive: true });
    cpSync(join(root, "tsconfig.base.json"), join(dir, "tsconfig.base.json"));
    cpSync(web, fixtureWeb, {
      recursive: true,
      filter: (path) =>
        !["node_modules", "dist", "test-results", "playwright-report"].includes(
          path.split("/").at(-1),
        ),
    });
    symlinkSync(join(web, "node_modules"), join(fixtureWeb, "node_modules"));
    writeFileSync(join(dir, ".gitignore"), "node_modules\ndist\n.vite\n");
    run(dir, "git", ["init", "-q"]);
    run(dir, "git", ["add", "."]);
    const commit = () =>
      run(dir, "git", [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ]);
    const build = () => {
      run(fixtureWeb, vp, ["run", "build"], {
        APP_REVISION: "",
        APP_COMMIT_TIME: "",
        APP_BUILD_TIME: "",
      });
      return JSON.parse(readFileSync(join(fixtureWeb, "dist/version.json"), "utf8"));
    };
    commit();
    const first = run(dir, "git", ["rev-parse", "HEAD"]);
    assert.equal(build().revision, first);
    writeFileSync(join(dir, "identity-fixture.txt"), "one");
    run(dir, "git", ["add", "identity-fixture.txt"]);
    commit();
    const second = run(dir, "git", ["rev-parse", "HEAD"]);
    assert.notEqual(second, first);
    assert.equal(build().revision, second);
    writeFileSync(join(dir, "identity-fixture.txt"), "two");
    assert.equal(build().revision, "dev");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
