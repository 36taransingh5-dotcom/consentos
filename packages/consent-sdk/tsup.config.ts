import { defineConfig } from "tsup";

// Published build: self-contained ESM and type declarations (no runtime or
// type dependencies — see src/types.ts).
export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts"],
  format: ["esm"],
  target: "es2022",
  clean: true,
  dts: true,
});
