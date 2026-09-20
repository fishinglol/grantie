import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileSystem } from "../src/fs.ts";

/**
 * Reference {@link FileSystem} adapter for Node (used by the desktop app's build
 * tooling and the demo). React Native supplies one backed by react-native-fs /
 * expo-file-system; Tauri supplies one backed by @tauri-apps/plugin-fs. Same
 * interface, ~15 lines each.
 */
export const nodeFs: FileSystem = {
  async readTextFile(path) {
    return readFile(path, "utf8");
  },
  async writeTextFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  },
  async writeBinaryFile(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },
  async exists(path) {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdirp(path) {
    await mkdir(path, { recursive: true });
  },
};
