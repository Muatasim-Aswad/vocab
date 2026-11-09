import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const before = process.env.SCAN_BEFORE ?? "";
const after = process.env.SCAN_AFTER ?? "HEAD";
assert(after === "HEAD" || /^[0-9a-f]{40}$/.test(after), "Invalid scan head");
assert(before === "" || /^[0-9a-f]{40}$/.test(before), "Invalid scan base");
execFileSync("git", ["rev-parse", "--verify", `${after}^{commit}`], { stdio: "ignore" });
const baseIsAncestor =
  before !== "" &&
  !/^0+$/.test(before) &&
  spawnSync("git", ["merge-base", "--is-ancestor", before, after], { stdio: "ignore" }).status ===
    0;
const range = baseIsAncestor ? `${before}..${after}` : after;
execFileSync("gitleaks", ["git", "--redact", "--no-banner", `--log-opts=${range}`], {
  stdio: "inherit",
});
