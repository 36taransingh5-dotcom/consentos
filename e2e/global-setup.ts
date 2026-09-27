import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build the extension so tests always load the current source. Hosted runs
 * build a separate copy whose default server is the deployed ConsentOS.
 */
export default function globalSetup() {
  const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const hosted = process.env.E2E_HOSTED === "1";
  execFileSync("node", ["build.mjs"], {
    cwd: path.join(root, "apps/extension"),
    stdio: "inherit",
    env: hosted
      ? { ...process.env, CONSENTOS_API_URL: process.env.E2E_CONSENTOS_URL, EXTENSION_OUT_DIR: "dist-hosted" }
      : process.env,
  });
}
