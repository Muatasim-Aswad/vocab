// Import boundaries (AGENTS.md, Architecture). Run through `vp run arch` / `mise run check`.
const src = "^apps/api/src/";

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "not-to-unresolvable",
      comment: "Includes deep imports that bypass a workspace package's `exports`",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-cross-app-imports",
      comment: "Apps talk over HTTP; share code through packages",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "packages-not-to-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "package-public-exports-only",
      comment: "Consume workspace packages through their built exports, never their sources",
      severity: "error",
      from: { path: "^(apps|packages)/([^/]+)/" },
      to: { path: "^packages/", pathNot: ["^packages/$2/", "^packages/[^/]+/dist/"] },
    },
    {
      name: "clients-no-node-apis",
      comment: "Web and shared packages run in browsers",
      severity: "error",
      from: { path: "^(apps/web/src|packages/[^/]+/src)/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "clients-no-server-libraries",
      comment: "Persistence, secrets, and server frameworks stay in the API",
      severity: "error",
      from: { path: "^(apps/web|packages/[^/]+)/src/" },
      to: {
        path: "node_modules/(better-sqlite3|drizzle-orm|drizzle-kit|@nestjs/[^/]+|@google/genai)/",
      },
    },
    {
      name: "cli-no-server-libraries",
      comment:
        "CLI talks to the API through @vocab/api-client; it owns no database or Gemini integration",
      severity: "error",
      from: { path: "^apps/cli/src/" },
      to: {
        path: "node_modules/(better-sqlite3|drizzle-orm|drizzle-kit|@nestjs/[^/]+|@google/genai)/",
      },
    },
    {
      name: "web-layer-direction",
      severity: "error",
      from: { path: "^apps/web/src/(features|infra|shared)/" },
      to: { path: "^apps/web/src/app/" },
    },
    {
      name: "web-shared-is-a-leaf",
      severity: "error",
      from: { path: "^apps/web/src/shared/" },
      to: { path: "^apps/web/src/(features|infra)/" },
    },
    {
      name: "web-infra-no-features",
      severity: "error",
      from: { path: "^apps/web/src/infra/" },
      to: { path: "^apps/web/src/features/" },
    },
    {
      name: "web-feature-public-api",
      severity: "error",
      from: { path: "^apps/web/src/features/([^/]+)/" },
      to: {
        path: "^apps/web/src/features/",
        pathNot: ["^apps/web/src/features/$1/", "^apps/web/src/features/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "cli-shared-is-a-leaf",
      severity: "error",
      from: { path: "^apps/cli/src/shared/" },
      to: { path: "^apps/cli/src/", pathNot: "^apps/cli/src/shared/" },
    },
    {
      name: "cli-infra-direction",
      severity: "error",
      from: { path: "^apps/cli/src/infra/" },
      to: { path: "^apps/cli/src/", pathNot: "^apps/cli/src/(infra|shared)/" },
    },
    {
      name: "cli-platform-direction",
      severity: "error",
      from: { path: "^apps/cli/src/platform/" },
      to: { path: "^apps/cli/src/", pathNot: "^apps/cli/src/(platform|infra|shared)/" },
    },
    {
      name: "cli-module-direction",
      severity: "error",
      from: { path: "^apps/cli/src/modules/" },
      to: { path: "^apps/cli/src/", pathNot: "^apps/cli/src/(modules|platform|infra|shared)/" },
    },
    {
      name: "api-business-no-http-platform",
      severity: "error",
      from: { path: `${src}modules/`, pathNot: "\\.controller\\.ts$" },
      to: { path: `${src}platform/` },
    },
    {
      name: "api-shared-is-a-leaf",
      severity: "error",
      from: { path: `${src}shared/` },
      to: { path: src, pathNot: `${src}shared/` },
    },
    {
      name: "api-config-uses-shared-only",
      severity: "error",
      from: { path: `${src}config\\.ts$` },
      to: { path: src, pathNot: `${src}shared/` },
    },
    {
      name: "api-infra-uses-shared-only",
      severity: "error",
      from: { path: `${src}infra/` },
      to: { path: src, pathNot: `${src}(infra|shared)/` },
    },
    {
      name: "api-platform-uses-shared-only",
      severity: "error",
      from: { path: `${src}platform/` },
      to: { path: src, pathNot: `${src}(platform|shared)/` },
    },
    {
      name: "api-modules-dependencies",
      comment:
        "Modules use other modules, platform (inbound), infra (outbound), and shared; never entrypoints or config",
      severity: "error",
      from: { path: `${src}modules/` },
      to: { path: src, pathNot: `${src}(modules|platform|infra|shared)/` },
    },
    {
      name: "api-modules-public-services-only",
      comment:
        "Cross-feature operations use services; schema projections, types and Nest wiring have narrow exceptions",
      severity: "error",
      from: { path: `${src}modules/([^/]+)/` },
      to: {
        path: `${src}modules/`,
        pathNot: [
          `${src}modules/$1/`,
          `${src}modules/[^/]+/[^/]+\\.service\\.ts$`,
          `${src}modules/study/(memory-state|study-memory\\.module)\\.ts$`,
          `${src}modules/vocabulary/(vocab\\.types|vocabulary\\.schema|vocabulary\\.module|word-normalization)\\.ts$`,
          `${src}modules/ai/ai-audit\\.module\\.ts$`,
          `${src}modules/captures/captures\\.module\\.ts$`,
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules", "/dist/"] },
    exclude: { path: ["^(apps|packages)/[^/]+/dist/", "/coverage/"] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
