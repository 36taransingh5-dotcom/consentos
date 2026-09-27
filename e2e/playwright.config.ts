import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/**
 * End-to-end demo flow across ConsentOS web (:3000), Pixly (:3001) and the
 * real MV3 extension loaded into Chromium.
 *
 *   pnpm test:e2e                 dev servers (reused if already running)
 *   E2E_PROD=1 pnpm test:e2e      production builds via `next start` (run `pnpm build` first)
 *   E2E_HOSTED=1 E2E_CONSENTOS_URL=https://… E2E_PIXLY_URL=https://… E2E_DEMO_RESET_TOKEN=… pnpm test:e2e
 *                                 deployed apps, extension built against the deployed ConsentOS
 */
const prod = process.env.E2E_PROD === "1";
const hosted = process.env.E2E_HOSTED === "1";

const localServers: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: `corepack pnpm --filter @consentos/web ${prod ? "start" : "dev"}`,
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !prod,
    cwd: "..",
    timeout: 180_000,
    // Production runs get their own local database, separate from development data.
    env: prod ? { CONSENTOS_DATA_DIR: ".data/e2e-prod" } : ({} as Record<string, string>),
  },
  {
    command: `corepack pnpm --filter @consentos/pixly ${prod ? "start" : "dev"}`,
    url: "http://localhost:3001",
    reuseExistingServer: !prod,
    cwd: "..",
    timeout: 180_000,
  },
];

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: hosted ? 30_000 : 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: { trace: "retain-on-failure" },
  webServer: hosted ? undefined : localServers,
});
