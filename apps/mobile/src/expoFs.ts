import { Directory, File } from 'expo-file-system';
import type { FileSystem } from '@granite/core-notes';

/**
 * `FileSystem` port implemented with Expo's file API (SDK 54+).
 * The desktop (Tauri) app provides an equivalent adapter over
 * `@tauri-apps/plugin-fs`. Nothing platform-specific leaks into `core-notes`.
 */
export const expoFs: FileSystem = {
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

  async exists(path) {
    return new File(path).exists;
  },

  async mkdirp(path) {
    new Directory(path).create({ intermediates: true, idempotent: true });
  },
};
