import { defineConfig } from "vite-plus";

export default defineConfig({
  // Suites start the built API as a separate process against disposable SQLite files.
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 90_000 },
  run: {
    tasks: { build: "tsc -p tsconfig.build.json && chmod +x dist/index.js", test: "vp test run" },
  },
});
