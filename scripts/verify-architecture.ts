// Negative check: writes forbidden imports as temporary probe files, asserts the boundary tools
// reject each one, and always removes the probes. Probe paths are also git-ignored, as a backstop.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

const root = join(import.meta.dirname, "..");

interface Probe {
  file: string;
  source: string;
  /** dependency-cruiser rule that must reject it; absent for a probe's helper file. */
  rule?: string;
}

const probes: Probe[] = [
  {
    file: "apps/web/src/arch-probe-app.ts",
    source: 'import "../../api/src/config.ts";',
    rule: "no-cross-app-imports",
  },
  {
    file: "apps/web/src/arch-probe-source.ts",
    source: 'import "../../../packages/contracts/src/errors.ts";',
    rule: "package-public-exports-only",
  },
  {
    file: "apps/web/src/arch-probe-deep.ts",
    source: 'import "@vocab/contracts/src/errors.ts";',
    rule: "not-to-unresolvable",
  },
  {
    file: "apps/cli/src/arch-probe-db.ts",
    source: 'import "../../api/node_modules/better-sqlite3";',
    rule: "cli-no-server-libraries",
  },
  {
    file: "apps/web/src/arch-probe-ai.ts",
    source: 'import "../../api/node_modules/@google/genai";',
    rule: "clients-no-server-libraries",
  },
  {
    file: "packages/api-client/src/arch-probe-node.ts",
    source: 'import "node:fs";',
    rule: "clients-no-node-apis",
  },
  {
    file: "apps/api/src/shared/arch-probe-leaf.ts",
    source: 'import "../infra/db/database.js";',
    rule: "api-shared-is-a-leaf",
  },
  {
    file: "apps/api/src/modules/arch-probe/arch-probe.controller.ts",
    source: 'import "../system/system.controller.js";',
    rule: "api-modules-public-services-only",
  },
  {
    file: "apps/web/src/shared/arch-probe-layer.ts",
    source: 'import "../app/i18n.ts";',
    rule: "web-layer-direction",
  },
  {
    file: "apps/web/src/shared/arch-probe-infra.ts",
    source: 'import "../infra/preferences.ts";',
    rule: "web-shared-is-a-leaf",
  },
  {
    file: "apps/web/src/shared/arch-probe-feature.ts",
    source: 'import "../features/session/index.ts";',
    rule: "web-shared-is-a-leaf",
  },
  {
    file: "apps/web/src/infra/arch-probe-feature.ts",
    source: 'import "../features/session/index.ts";',
    rule: "web-infra-no-features",
  },
  {
    file: "apps/web/src/features/session/arch-probe-private.ts",
    source: 'import "../vocabulary/store.ts";',
    rule: "web-feature-public-api",
  },
  {
    file: "apps/cli/src/infra/arch-probe-layer.ts",
    source: 'import "../modules/study/study.ts";',
    rule: "cli-infra-direction",
  },
  {
    file: "apps/cli/src/shared/arch-probe-layer.ts",
    source: 'import "../infra/config.ts";',
    rule: "cli-shared-is-a-leaf",
  },
  {
    file: "apps/cli/src/platform/arch-probe-layer.ts",
    source: 'import "../modules/study/study.ts";',
    rule: "cli-platform-direction",
  },
  {
    file: "apps/cli/src/modules/study/arch-probe-layer.ts",
    source: 'import "../../app.ts";',
    rule: "cli-module-direction",
  },
  {
    file: "apps/api/src/modules/study/arch-probe-transport.ts",
    source: 'import "../../platform/http/error.filter.js";',
    rule: "api-business-no-http-platform",
  },
  {
    file: "apps/api/src/platform/arch-probe-a.ts",
    source: 'import "./arch-probe-b.js";',
    rule: "no-circular",
  },
  { file: "apps/api/src/platform/arch-probe-b.ts", source: 'import "./arch-probe-a.js";' },
];

// An export used only by a test must fail the production unused-code check.
const testOnly = [
  { file: "apps/api/src/shared/arch-probe-test-only.ts", source: "export const testOnly = 1;\n" },
  {
    file: "apps/api/test/arch-probe.e2e-spec.ts",
    source:
      'import { testOnly } from "../src/shared/arch-probe-test-only.js";\n\nexport const probe = testOnly;\n',
  },
];

function run(command: string, args: string[]): { status: number; stdout: string } {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" }),
    };
  } catch (error) {
    // execFileSync failures carry the exit status and captured output
    return z.object({ status: z.number(), stdout: z.string() }).parse(error);
  }
}

const written = [...probes, ...testOnly].map((probe) => join(root, probe.file));
const cleanup = () => {
  for (const file of written) rmSync(file, { force: true });
  rmSync(join(root, "apps/api/src/modules/arch-probe"), { recursive: true, force: true });
};
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const failures: string[] = [];
const checked = probes.filter((probe) => probe.rule);
try {
  for (const probe of [...probes, ...testOnly]) {
    mkdirSync(dirname(join(root, probe.file)), { recursive: true });
    writeFileSync(join(root, probe.file), `${probe.source}\n`);
  }

  const cruise = run("depcruise", [
    ...probes.map((probe) => probe.file),
    "--config",
    ".dependency-cruiser.mjs",
    "--output-type",
    "json",
  ]);
  const { violations } = z
    .object({
      summary: z.object({
        violations: z.array(z.object({ from: z.string(), rule: z.object({ name: z.string() }) })),
      }),
    })
    .parse(JSON.parse(cruise.stdout)).summary;
  for (const probe of checked) {
    if (!violations.some((v) => v.from === probe.file && v.rule.name === probe.rule)) {
      failures.push(`${probe.file}: expected ${probe.rule}`);
    }
  }

  const knip = run("knip", ["--production", "--no-progress", "--no-gitignore"]);
  if (knip.status === 0 || !knip.stdout.includes("arch-probe-test-only")) {
    failures.push("knip --production accepted a test-only export");
  }
} finally {
  cleanup();
}

if (failures.length) {
  console.error(`Architecture checks accepted forbidden code:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture checks rejected all ${checked.length + 1} forbidden probes.`);
}
