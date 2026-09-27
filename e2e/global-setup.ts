import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Build the extension so tests always load the current source. */
export default function globalSetup() {
  const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  execFileSync("node", ["build.mjs"], { cwd: path.join(root, "apps/extension"), stdio: "inherit" });
}
