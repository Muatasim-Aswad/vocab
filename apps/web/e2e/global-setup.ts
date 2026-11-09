import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate, requireBuilds, startApi } from "./support/api-server.ts";
import { e2eToken, seed } from "./support/fixtures.ts";

/**
 * Migrates a disposable database, starts the built API (serving the built web app) on an
 * ephemeral port, seeds legacy-shaped vocabulary through the real API, and stops it gracefully.
 */
export default async function globalSetup() {
  requireBuilds();
  const dir = mkdtempSync(join(tmpdir(), "vocab-e2e-"));
  const databasePath = join(dir, "e2e.db");
  migrate(databasePath);
  const server = await startApi(databasePath, e2eToken);
  process.env.E2E_BASE_URL = server.baseUrl;
  await seed(server.baseUrl);

  return async () => {
    try {
      await server.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
