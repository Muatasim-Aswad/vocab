import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    testTimeout: 30_000,
  },
  run: {
    tasks: {
      // Nest reads its previous output and incremental state while rebuilding; neither is an input.
      build: {
        command: "nest build",
        cache: { input: [{ auto: true }, "!dist/**", "!*.tsbuildinfo"] },
      },
      test: "vp test run",
    },
  },
});
