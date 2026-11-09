import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
assert(
  args.every((arg) => ["--sync-version", "--write-inventory"].includes(arg)),
  "Unknown option",
);
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Invalid product version");

for (const area of ["apps", "packages"]) {
  for (const entry of readdirSync(resolve(root, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(root, area, entry.name, "package.json");
    const workspace = JSON.parse(readFileSync(path, "utf8"));
    if (args.includes("--sync-version")) {
      workspace.version = manifest.version;
      writeFileSync(path, `${JSON.stringify(workspace, null, 2)}\n`);
    }
    assert.equal(workspace.version, manifest.version, `Version drift: ${area}/${entry.name}`);
    assert.equal(workspace.license, "MIT", `Missing MIT declaration: ${area}/${entry.name}`);
  }
}
assert.equal(manifest.license, "MIT", "Missing root MIT declaration");
if (args.includes("--sync-version") && !args.includes("--write-inventory")) {
  console.log(`Workspace versions synchronized to ${manifest.version}`);
  process.exit(0);
}

const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .toSorted();
assert.equal(new Set(files).size, files.length, "Duplicate index entries; resolve merge conflicts");
const privatePath =
  /(^|\/)(docs\/plans|node_modules|dist|coverage|test-results|playwright-report|\.relay)(\/|$)|(^|\/)\.env($|\.(?!example$))|\.(db|sqlite)(-|\.|$)|\.local(\.md)?$|(^|\/)compose\.(override|.*\.(local|private))\.ya?ml$/;
for (const file of files)
  assert(!privatePath.test(file), `Private or generated tracked path: ${file}`);
const inventory = resolve(root, "scripts/publication/source-inventory.txt");
const expected = `${files.join("\n")}\n`;
if (args.includes("--write-inventory")) writeFileSync(inventory, expected);
else {
  const reviewed = readFileSync(inventory, "utf8");
  assert(
    reviewed === expected,
    "Tracked source inventory changed; review and update the allowlist",
  );
}
console.log(
  `Public source: ${files.length} allowlisted files; version ${manifest.version}; MIT declarations verified`,
);
