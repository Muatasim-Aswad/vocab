import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { view } from "../ui/terminal.mjs";

const MEMORY_LOGS_DIR_RELATIVE = "src/data/memory/logs";

export function handleQuitWithCommit(dbFilePath: string): void {
  commitDbAndLogsIfChanged(dbFilePath);
  process.exit(0);
}

function commitDbAndLogsIfChanged(dbFilePath: string): void {
  const gitRoot = getGitRoot();
  if (!gitRoot) return;

  const relativeDbPath = toRepoRelativePath(gitRoot, dbFilePath);
  const logsDirAbsolute = path.join(gitRoot, MEMORY_LOGS_DIR_RELATIVE);
  const includeLogsDir = fs.existsSync(logsDirAbsolute);

  const includedPathspecs = [
    ...(relativeDbPath ? [relativeDbPath] : []),
    ...(includeLogsDir ? [MEMORY_LOGS_DIR_RELATIVE] : []),
  ];

  if (includedPathspecs.length === 0) return;

  if (hasNonIncludedStagedChanges(gitRoot, includedPathspecs)) {
    view("Skipping auto-commit (other staged changes exist).");
    return;
  }

  if (!hasChanges(gitRoot, includedPathspecs)) return;

  const add = spawnSync("git", ["add", "--", ...includedPathspecs], {
    cwd: gitRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (add.status !== 0) {
    view(`Failed to stage changes for commit:\n${add.stderr.trim()}`);
    return;
  }

  const message = `db:${new Date().toISOString()}`;
  const commit = spawnSync("git", ["commit", "-m", message], {
    cwd: gitRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (commit.status !== 0) {
    const errorOutput = commit.stderr.trim() || commit.stdout.trim();
    if (errorOutput) view(`Failed to commit changes:\n${errorOutput}`);
    return;
  }

  view(`Committed changes: ${message}`);

  const push = spawnSync("git", ["push"], {
    cwd: gitRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (push.status !== 0) {
    const errorOutput = push.stderr.trim() || push.stdout.trim();
    if (errorOutput) view(`Failed to push changes:\n${errorOutput}`);
    return;
  }

  const pushOutput = push.stdout.trim();
  if (pushOutput) view(pushOutput);
}

function getGitRoot(): string | null {
  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (gitRootResult.status !== 0) return null;
  return gitRootResult.stdout.trim() || null;
}

function toRepoRelativePath(
  gitRoot: string,
  absolutePath: string,
): string | null {
  if (!absolutePath) return null;
  if (!fs.existsSync(absolutePath)) return null;

  const relativePath = path.relative(gitRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    view(`Skipping db auto-commit (outside repo): ${absolutePath}`);
    return null;
  }

  return relativePath;
}

function hasNonIncludedStagedChanges(
  gitRoot: string,
  includedPathspecs: string[],
): boolean {
  const stagedChanges = spawnSync("git", ["diff", "--name-only", "--cached"], {
    cwd: gitRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (stagedChanges.status !== 0) {
    view("Skipping auto-commit (could not read git index).");
    return true;
  }

  const stagedFiles = stagedChanges.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return stagedFiles.some((file) => !isIncluded(file, includedPathspecs));
}

function hasChanges(gitRoot: string, includedPathspecs: string[]): boolean {
  const status = spawnSync(
    "git",
    ["status", "--porcelain=1", "--", ...includedPathspecs],
    {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (status.status !== 0) {
    view("Skipping auto-commit (could not read git status).");
    return false;
  }

  return Boolean(status.stdout.trim());
}

function isIncluded(file: string, includedPathspecs: string[]): boolean {
  return includedPathspecs.some((spec) => {
    if (spec === file) return true;
    const prefix = spec.endsWith(path.sep) ? spec : `${spec}${path.sep}`;
    return file.startsWith(prefix);
  });
}
