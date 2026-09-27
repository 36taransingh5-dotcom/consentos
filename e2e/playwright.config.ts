import { defineConfig } from "@playwright/test";

/**
 * End-to-end demo flow across ConsentOS web (:3000), Pixly (:3001) and the
 * real MV3 extension loaded into Chromium. Reuses running dev servers.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: { trace: "retain-on-failure" },
  webServer: [
    {
      command: "corepack pnpm --filter @consentos/web dev",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      cwd: "..",
      timeout: 180_000,
    },
    {
      command: "corepack pnpm --filter @consentos/pixly dev",
      url: "http://localhost:3001",
      reuseExistingServer: true,
      cwd: "..",
      timeout: 180_000,
    },
  ],
});
