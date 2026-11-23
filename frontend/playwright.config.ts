import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de fumée : chaque onglet du terminal s'ouvre sans erreur JavaScript ni erreur du backend.
 * Lancement : `npm run e2e` (réutilise le terminal s'il tourne déjà, sinon le démarre avec start.sh).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 4,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000", viewport: { width: 1600, height: 950 } },
  webServer: { command: "cd .. && NO_OPEN=1 ./start.sh", url: "http://localhost:3000", reuseExistingServer: true, timeout: 300_000 },
});
