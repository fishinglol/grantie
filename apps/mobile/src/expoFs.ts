import { Directory, File } from 'expo-file-system';
import type { VaultFileSystem } from '@granite/core-cloud';

/**
 * `VaultFileSystem` (note editing + what sync needs) implemented with Expo's file API.
 * The desktop (Tauri) app provides an equivalent adapter over `@tauri-apps/plugin-fs`.
 */
export const expoFs: VaultFileSystem = {
  async readTextFile(path) {
    return new File(path).text();
  },

  async writeTextFile(path, content) {
    const file = new File(path);
    file.parentDirectory.create({ intermediates: true, idempotent: true });
    if (!file.exists) file.create({ overwrite: true });
    file.write(content);
  },

  async writeBinaryFile(path, data) {
    const file = new File(path);
    file.parentDirectory.create({ intermediates: true, idempotent: true });
    if (!file.exists) file.create({ overwrite: true });
    file.write(data);
  },

  async readBinaryFile(path) {
    return new File(path).bytes();
  },

  async exists(path) {
    return new File(path).exists || new Directory(path).exists;
  },

  async mkdirp(path) {
    new Directory(path).create({ intermediates: true, idempotent: true });
  },

  async listDir(path) {
    return new Directory(path).list().map((entry) => ({
      name: entry.name,
      isDirectory: entry instanceof Directory,
    }));
  },

  async stat(path) {
    const info = new File(path).info();
    return { size: info.size ?? 0, modifiedMs: info.modificationTime ?? 0 };
  },
};
