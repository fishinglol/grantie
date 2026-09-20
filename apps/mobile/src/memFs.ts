import type { MovableFs } from './expoFs';

/**
 * In-memory `MovableFs` for the **web preview** (`npm run web`).
 * `expo-file-system` is not available on web; this lets the real UI + real
 * `@granite/core-notes` logic run in a browser for fast iteration. Nothing
 * persists across reloads.
 */
const files = new Map<string, string | Uint8Array>();
const dirs = new Set<string>();

const asDir = (path: string) => (path.endsWith('/') ? path : `${path}/`);

export const memFs: MovableFs = {
  async readTextFile(path) {
    const v = files.get(path);
    if (typeof v !== 'string') throw new Error(`memFs: not found — ${path}`);
    return v;
  },
  async writeTextFile(path, content) {
    files.set(path, content);
  },
  async writeBinaryFile(path, data) {
    files.set(path, data);
  },
  async readBinaryFile(path) {
    const v = files.get(path);
    if (!(v instanceof Uint8Array)) throw new Error(`memFs: not found — ${path}`);
    return v;
  },
  async exists(path) {
    return files.has(path) || dirs.has(path);
  },
  async mkdirp(path) {
    dirs.add(path);
  },
  async removeFile(path) {
    files.delete(path);
  },
  async moveFile(from, to) {
    const v = files.get(from);
    if (v === undefined) throw new Error(`memFs: not found — ${from}`);
    files.set(to, v);
    files.delete(from);
  },
  async listDir(path) {
    const prefix = asDir(path);
    const entries = new Map<string, boolean>();
    for (const key of [...files.keys(), ...dirs]) {
      if (!key.startsWith(prefix) || key === path) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split('/')[0]!;
      if (name) entries.set(name, entries.get(name) || rest.includes('/') || dirs.has(key));
    }
    return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }));
  },
  async stat(path) {
    const v = files.get(path);
    return { size: typeof v === 'string' ? v.length : (v?.byteLength ?? 0), modifiedMs: Date.now() };
  },
};

/** Browser-loadable URL for an image held in memory (web preview only). */
export function memImageUrl(path: string): string | undefined {
  const v = files.get(path);
  return v instanceof Uint8Array ? URL.createObjectURL(new Blob([v as BlobPart])) : undefined;
}
