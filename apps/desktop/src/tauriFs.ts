import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FolderFs } from "@granite/core-notes";
import type { DirEntry, VaultFileSystem } from "@granite/core-cloud";

const isTauri = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const memFiles = new Map<string, string | Uint8Array>();
const memDirs = new Set<string>();

/**
 * `VaultFileSystem` port implemented with the Tauri fs plugin on desktop,
 * with an in-memory fallback for browser preview / headless tests.
 */
export const tauriFs: VaultFileSystem = {
  async readTextFile(path) {
    if (!isTauri()) {
      const val = memFiles.get(path);
      if (typeof val === "string") return val;
      if (val instanceof Uint8Array) return new TextDecoder().decode(val);
      throw new Error(`File not found: ${path}`);
    }
    return readTextFile(path);
  },
  async writeTextFile(path, content) {
    if (!isTauri()) {
      memFiles.set(path, content);
      return;
    }
    return writeTextFile(path, content);
  },
  async writeBinaryFile(path, data) {
    if (!isTauri()) {
      memFiles.set(path, data);
      return;
    }
    return writeFile(path, data);
  },
  async readBinaryFile(path) {
    if (!isTauri()) {
      const val = memFiles.get(path);
      if (val instanceof Uint8Array) return val;
      if (typeof val === "string") return new TextEncoder().encode(val);
      throw new Error(`File not found: ${path}`);
    }
    return readFile(path);
  },
  async exists(path) {
    if (!isTauri()) {
      return memFiles.has(path) || memDirs.has(path);
    }
    return exists(path);
  },
  async mkdirp(path) {
    if (!isTauri()) {
      // Recursive, like the real one: the parents exist too.
      for (let p = path; p.length > 1; p = p.slice(0, Math.max(0, p.lastIndexOf("/")))) memDirs.add(p);
      return;
    }
    try {
      await mkdir(path, { recursive: true });
    } catch {
      /* already exists */
    }
  },
  async listDir(path) {
    if (!isTauri()) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const entries: DirEntry[] = [];
      const seen = new Set<string>();
      for (const k of memFiles.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          const seg = rest.split("/")[0]!;
          if (!seen.has(seg)) {
            seen.add(seg);
            entries.push({ name: seg, isDirectory: rest.includes("/") });
          }
        }
      }
      for (const d of memDirs) {
        if (d.startsWith(prefix)) {
          const seg = d.slice(prefix.length).split("/")[0]!;
          if (seg && !seen.has(seg)) {
            seen.add(seg);
            entries.push({ name: seg, isDirectory: true });
          }
        }
      }
      return entries;
    }
    const entries = await readDir(path);
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
  },
  async removeFile(path) {
    if (!isTauri()) {
      memFiles.delete(path);
      return;
    }
    await remove(path);
  },
  async removeDir(path) {
    if (!isTauri()) {
      for (const k of [...memFiles.keys()]) if (k.startsWith(`${path}/`)) memFiles.delete(k);
      for (const d of [...memDirs]) if (d === path || d.startsWith(`${path}/`)) memDirs.delete(d);
      return;
    }
    await remove(path, { recursive: true });
  },
  async stat(path) {
    if (!isTauri()) {
      const val = memFiles.get(path);
      const size = typeof val === "string" ? val.length : (val?.byteLength ?? 0);
      return { size, modifiedMs: Date.now() };
    }
    const info = await stat(path);
    return { size: info.size, modifiedMs: info.mtime ? new Date(info.mtime).getTime() : 0 };
  },
};

/** Move (rename) a file. Callers must check the destination doesn't exist. */
export async function moveFile(from: string, to: string): Promise<void> {
  if (!isTauri()) {
    const val = memFiles.get(from);
    if (val === undefined) throw new Error(`File not found: ${from}`);
    memFiles.set(to, val);
    memFiles.delete(from);
    return;
  }
  await rename(from, to);
}

/** What moving a folder needs: the vault filesystem plus file moves. */
export const folderFs: VaultFileSystem & FolderFs = { ...tauriFs, moveFile };
