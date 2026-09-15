import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

export interface BlenderInstall {
  path: string;
  version?: string;
  source: "program-files" | "path" | "common" | "steam" | "manual";
}

function versionOf(exe: string): string | undefined {
  try {
    const out = execFileSync(exe, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    const m = /Blender\s+(\d+\.\d+[^\s]*)/.exec(out);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort discovery. Never throws, never blocks the product. */
export function discoverBlender(): BlenderInstall[] {
  const found = new Map<string, BlenderInstall>();

  const add = (p: string, source: BlenderInstall["source"]) => {
    if (!p || !fs.existsSync(p)) return;
    const key = path.resolve(p);
    if (found.has(key)) return;
    found.set(key, { path: key, source });
  };

  // 1) PATH
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, ["blender"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((p) => add(p, "path"));
  } catch {
    /* not on PATH */
  }

  if (process.platform === "win32") {
    const roots = [
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      path.join(os.homedir(), "AppData", "Local", "Programs"),
      "D:\\Program Files",
      "D:\\",
    ];
    for (const root of roots) {
      const base = path.join(root, "Blender Foundation");
      if (!fs.existsSync(base)) continue;
      for (const dir of safeReaddir(base)) {
        add(path.join(base, dir, "blender.exe"), "program-files");
      }
    }
    // portable / manual installs such as D:\Chat2Blend\_tools\blender-4.2.9-windows-x64
    for (const root of ["D:\\", "C:\\"]) {
      for (const dir of safeReaddir(root)) {
        if (/^blender-?\d/i.test(dir)) add(path.join(root, dir, "blender.exe"), "common");
      }
    }
  } else if (process.platform === "darwin") {
    add("/Applications/Blender.app/Contents/MacOS/Blender", "common");
    const apps = path.join(os.homedir(), "Applications");
    for (const dir of safeReaddir(apps)) {
      if (/blender/i.test(dir)) add(path.join(apps, dir, "Contents", "MacOS", "Blender"), "common");
    }
  } else {
    ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"].forEach((p) =>
      add(p, "common"),
    );
  }

  const list = [...found.values()];
  // version probing is only worth it for a couple of candidates
  list.slice(0, 3).forEach((b) => {
    b.version = versionOf(b.path);
  });
  return list;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Blender's per-version add-on directory, where users install add-ons. */
export function blenderAddonDirs(): string[] {
  const out: string[] = [];
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    out.push(path.join(roaming, "Blender Foundation", "Blender"));
  } else if (process.platform === "darwin") {
    out.push(path.join(os.homedir(), "Library", "Application Support", "Blender"));
  } else {
    out.push(path.join(os.homedir(), ".config", "blender"));
  }
  return out;
}

/** Concrete .../scripts/addons dirs if they already exist. */
export function blenderAddonsPaths(): string[] {
  const out: string[] = [];
  for (const base of blenderAddonDirs()) {
    if (!fs.existsSync(base)) continue;
    for (const versionDir of safeReaddir(base)) {
      if (!/^\d+\.\d+$/.test(versionDir)) continue;
      const p = path.join(base, versionDir, "scripts", "addons");
      out.push(p);
    }
  }
  return out;
}
