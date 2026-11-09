import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    // Tasks, unlike package.json scripts, are cached. Only deterministic steps are tasks; e2e, dev,
    // arch and db:* stay scripts so they always run.
    tasks: {
      test: "node --test scripts/build-info/*.test.mjs scripts/migration/*.test.mjs scripts/recovery/*.test.mjs",
    },
  },
  fmt: {
    proseWrap: "never",
    overrides: [
      { files: ["CONTEXT.md", "apps/api/evals/README.md"], options: { proseWrap: "preserve" } },
    ],
    sortImports: true,
    sortTailwindcss: { stylesheet: "apps/web/src/app/styles.css", functions: ["cn"] },
    ignorePatterns: [
      "pnpm-lock.yaml",
      // Plans are historical references, kept as written
      "docs/plans/**",
      "docs/migration/*.local.md",
      "docs/operations.md",
      "docs/deployment*.local.md",
      "docs/migration/reports/**",
      "scripts/migration/reports/**",
    ],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "import"],
    categories: {
      correctness: "error",
      suspicious: "warn",
    },
    rules: {
      "typescript/no-floating-promises": "error",
      // Nest modules are empty decorated classes
      "typescript/no-extraneous-class": ["warn", { allowWithDecorator: true }],
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    overrides: [
      {
        files: ["**/*.ts", "**/*.tsx"],
        rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      },
      {
        files: ["apps/web/**"],
        plugins: ["react"],
        rules: {
          "react/rules-of-hooks": "error",
          "react/only-export-components": ["warn", { allowConstantExport: true }],
          // React 17+ JSX transform needs no `React` in scope
          "react/react-in-jsx-scope": "off",
          "import/no-unassigned-import": ["warn", { allow: ["**/*.css", "**/zod-config.ts"] }],
        },
      },
    ],
    ignorePatterns: [
      "**/dist/**",
      "**/coverage/**",
      "docs/plans/**",
      "docs/migration/reports/**",
      "scripts/migration/reports/**",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
