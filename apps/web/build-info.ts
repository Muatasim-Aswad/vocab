import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/** Mirrors the schema in `src/infra/build-info.ts`, which the browser reads. */
interface BuildInfo {
  readonly version: string | null;
  readonly revision: string;
  readonly committedAt: string | null;
  readonly builtAt: string;
}

/**
 * Bakes the build's identity into the bundle as `import.meta.env.BUILD_INFO` and emits the
 * same record as `version.json`, which always describes what is deployed.
 *
 * srvr passes `APP_*` variables into the image build, which has no `.git`; a
 * local build asks git instead; with neither, the revision is `dev`.
 */
export function buildInfo(): Plugin {
  let json = "";
  return {
    name: "build-info",
    config(config) {
      const info = readBuildInfo(config.root ?? process.cwd());
      json = `${JSON.stringify(info, null, 2)}\n`;
      // A JSON string, because Vitest hands `import.meta.env` values over as strings.
      return { define: { "import.meta.env.BUILD_INFO": JSON.stringify(JSON.stringify(info)) } };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.split("?")[0]?.endsWith("/version.json")) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(json);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: json });
    },
  };
}

function readBuildInfo(root: string): BuildInfo {
  const status = git(root, "status", "--porcelain", "--untracked-files=normal");
  const dirty = status !== null && status !== "";

  return {
    version: packageVersion(root),
    revision: dirty ? "dev" : (env("APP_REVISION") ?? git(root, "rev-parse", "HEAD") ?? "dev"),
    committedAt: dirty
      ? null
      : (env("APP_COMMIT_TIME") ?? git(root, "show", "--no-patch", "--format=%cI", "HEAD")),
    builtAt: env("APP_BUILD_TIME") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

function packageVersion(root: string): string | null {
  const manifest: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : null;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

function git(root: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
}
