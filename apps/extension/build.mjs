// Bundles the extension into dist/, ready for chrome://extensions → Load unpacked.
//
//   CONSENTOS_API_URL=https://consentos.example node build.mjs
//
// sets the default ConsentOS server and adds it to host_permissions.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const apiUrl = (process.env.CONSENTOS_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
// EXTENSION_OUT_DIR lets a build for a deployed server live next to the local one (e.g. dist-hosted).
const out = path.resolve(process.env.EXTENSION_OUT_DIR ?? "dist");

function writeStatic() {
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  for (const file of ["popup.html", "popup.css"]) {
    fs.copyFileSync(path.join("public", file), path.join(out, file));
  }
  for (const icon of fs.readdirSync("public/icons")) {
    fs.copyFileSync(path.join("public/icons", icon), path.join(out, "icons", icon));
  }
  const manifest = JSON.parse(fs.readFileSync("public/manifest.json", "utf8"));
  const origin = `${new URL(apiUrl).origin}/*`;
  if (!manifest.host_permissions.includes(origin)) manifest.host_permissions.push(origin);
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
}

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: "chrome120",
  logLevel: "info",
  define: {
    __CONSENTOS_API_URL__: JSON.stringify(apiUrl),
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
  },
};

const builds = [
  { ...common, entryPoints: ["src/background.ts"], outfile: path.join(out, "background.js"), format: "esm" },
  { ...common, entryPoints: ["src/content.ts"], outfile: path.join(out, "content.js"), format: "iife" },
  { ...common, entryPoints: ["src/detect.ts"], outfile: path.join(out, "detect.js"), format: "iife" },
  { ...common, entryPoints: ["src/popup/main.tsx"], outfile: path.join(out, "popup.js"), format: "iife", jsx: "automatic" },
];

fs.rmSync(out, { recursive: true, force: true });
writeStatic();

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
  fs.watch("public", { recursive: true }, () => writeStatic());
  console.log(`[extension] watching — default server ${apiUrl}`);
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  console.log(`[extension] built ${path.relative(process.cwd(), out)}/ — default server ${apiUrl}`);
}
