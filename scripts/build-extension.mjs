#!/usr/bin/env node
/**
 * Bundle the browser extension using the esbuild JS API.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "apps", "extension", "src");
const DIST = path.join(ROOT, "apps", "extension", "dist");

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const targets = [
  // content script: classic IIFE
  { entry: "content.ts", out: "content.js", format: "iife" },
  // service worker: ES module
  { entry: "background.ts", out: "background.js", format: "esm" },
  // popup: classic script in an HTML page
  { entry: "popup.ts", out: "popup.js", format: "iife" },
];

for (const t of targets) {
  await esbuild.build({
    entryPoints: [path.join(SRC, t.entry)],
    bundle: true,
    platform: "browser",
    target: "es2020",
    format: t.format,
    outfile: path.join(DIST, t.out),
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "warning",
  });
}

// static files
for (const file of ["manifest.json", "popup.html"]) {
  fs.copyFileSync(path.join(ROOT, "apps", "extension", file), path.join(DIST, file));
}

// generate a simple 128x128 icon using a local python interpreter
const python = process.env.PYTHON || "python";
const icon = spawnSync(python, [path.join(ROOT, "scripts", "gen-icon.py"), path.join(DIST, "icon128.png")], { encoding: "utf8" });
if (icon.status !== 0) {
  console.error("icon gen failed:", icon.stderr || icon.stdout || "");
  process.exit(1);
}

console.log("extension build complete:", DIST);
