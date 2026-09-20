import type { FileSystem } from '@granite/core-notes';

/**
 * In-memory `FileSystem` for the **web preview** (`npx expo start --web`).
 * `expo-file-system` is not available on web; this lets the real UI + real
 * `@granite/core-notes` logic run in a browser for fast iteration. Nothing
 * persists across reloads.
 */
const textFiles = new Map<string, string>();
const blobUrls = new Map<string, string>();

export const memFs: FileSystem & { toDisplayUri(path: string): string | undefined } = {
  async readTextFile(path) {
    const v = textFiles.get(path);
    if (v === undefined) throw new Error(`memFs: not found — ${path}`);
    return v;
  },
  async writeTextFile(path, content) {
    textFiles.set(path, content);
  },
  async writeBinaryFile(path, data) {
    const prev = blobUrls.get(path);
    if (prev) URL.revokeObjectURL(prev);
    blobUrls.set(path, URL.createObjectURL(new Blob([data as BlobPart])));
  },
  async exists(path) {
    return textFiles.has(path) || blobUrls.has(path);
  },
  async mkdirp() {
    /* directories are implicit in memory */
  },
  toDisplayUri(path) {
    return blobUrls.get(path);
  },
};
