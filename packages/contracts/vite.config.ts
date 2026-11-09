import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  run: { tasks: { build: "vp pack", test: "vp test run" } },
});
