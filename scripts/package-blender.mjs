#!/usr/bin/env node
/**
 * Package the Blender add-on as a zip that can be installed from
 * Edit > Preferences > Add-ons > Install...
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "blender_addon", "chat2blend");
const OUT_DIR = path.join(ROOT, "dist");
const OUT = path.join(OUT_DIR, "chat2blend-blender.zip");

if (!fs.existsSync(SRC)) {
  console.error("add-on source not found:", SRC);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// Use Python's zipfile for a clean archive with correct paths.
const py = process.env.PYTHON || "python";
const pyScript = `
import zipfile, os, sys
src = r"${SRC}"
out = r"${OUT}"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, os.path.dirname(src))
            z.write(full, arc)
print(out)
`;
const r = spawnSync(py, ["-c", pyScript], { encoding: "utf8" });
if (r.status !== 0) {
  console.error("zip failed:", r.stderr || r.stdout || "");
  process.exit(1);
}
console.log("packaged:", OUT);
