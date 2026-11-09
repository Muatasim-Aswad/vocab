import { defineConfig, devices } from "@playwright/test";

// Real-browser smoke test of the production topology: the built API serves the built web app.
// Requires `vp run -r build` first (the `mise run check` gate does this).
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  outputDir: "node_modules/.playwright/results",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
