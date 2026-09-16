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
    const out = execFileSync(cmd, ["blender"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
    // Steam (very common, and invisible to Program Files / PATH discovery)
    for (const root of steamRoots()) {
      add(path.join(root, "steamapps", "common", "Blender", "blender.exe"), "steam");
    }
    // MSI / custom installs: only worth the registry walk if we found nothing
    if (found.size === 0) {
      for (const exe of registryBlenderExes()) add(exe, "common");
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

function regValue(key: string, value: string): string | undefined {
  try {
    const out = execFileSync("reg", ["query", key, "/v", value], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const m = new RegExp(`^\\s*${value}\\s+REG_\\w+\\s+(.+)$`, "m").exec(out);
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

function regTree(key: string): string {
  try {
    return execFileSync("reg", ["query", key, "/s"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/**
 * Steam library roots: the install path itself plus every library listed in
 * `steamapps/libraryfolders.vdf`. Steam is a very common way to install Blender
 * and it does not register the executable in Program Files or on PATH.
 */
function steamRoots(): string[] {
  const roots: string[] = [];
  const push = (p?: string) => {
    if (!p) return;
    const clean = p.replace(/\//g, "\\").replace(/\\+$/, "");
    if (clean && !roots.includes(clean)) roots.push(clean);
  };

  push(
    regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath") ??
      regValue("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath") ??
      regValue("HKCU\\SOFTWARE\\Valve\\Steam", "SteamPath"),
  );

  for (const root of [...roots]) {
    const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
    if (!fs.existsSync(vdf)) continue;
    try {
      const text = fs.readFileSync(vdf, "utf8");
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        push(m[1].replace(/\\\\/g, "\\"));
      }
    } catch {
      /* ignore malformed vdf */
    }
  }
  return roots;
}

/**
 * Last resort on Windows: walk the Uninstall registry keys for a "Blender"
 * display name and try its InstallLocation / DisplayIcon. Covers MSI installs
 * on a drive that is not C:.
 */
function registryBlenderExes(): string[] {
  const bases = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];
  const out: string[] = [];
  for (const base of bases) {
    let isBlender = false;
    for (const raw of regTree(base).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("HKEY")) {
        isBlender = false;
        continue;
      }
      const dm = /^DisplayName\s+REG_\w+\s+(.+)$/.exec(line);
      if (dm && /blender/i.test(dm[1])) isBlender = true;
      if (!isBlender) continue;
      const im = /^(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/.exec(line);
      if (!im) continue;
      const v = im[2].trim();
      if (!v) continue;
      out.push(/\.exe$/i.test(v) ? v : path.join(v, "blender.exe"));
    }
  }
  return out;
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
