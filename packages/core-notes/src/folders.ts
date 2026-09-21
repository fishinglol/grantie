import type { FileSystem } from "./fs.ts";
import { join } from "./path.ts";
import { relocateLinks } from "./relocateLinks.ts";

/** What moving or deleting a folder needs beyond plain note editing. */
export interface FolderFs extends FileSystem {
  listDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
  moveFile(from: string, to: string): Promise<void>;
  /** Delete a folder and everything in it. */
  removeDir(path: string): Promise<void>;
}

const NOTE = /\.(md|markdown)$/i;

/**
 * Move the folder `from` to `to` (which must not exist yet and must not be inside `from`).
 *
 * Files move one by one, so it needs nothing but the file-level `moveFile` both platforms already have.
 * Notes inside get their relative links fixed if they point outside the folder; links inside it
 * (such as the folder's own `assets/`) still work because everything moves together.
 */
export async function moveFolder(fs: FolderFs, from: string, to: string): Promise<void> {
  async function walk(src: string, dest: string): Promise<void> {
    await fs.mkdirp(dest);
    for (const entry of await fs.listDir(src)) {
      const s = join(src, entry.name);
      const d = join(dest, entry.name);
      if (entry.isDirectory) {
        await walk(s, d);
        continue;
      }
      const text = NOTE.test(entry.name) ? await fs.readTextFile(s) : null;
      await fs.moveFile(s, d);
      if (text === null) continue;
      const fixed = relocateLinks(text, src, dest, { from });
      if (fixed !== text) await fs.writeTextFile(d, fixed);
    }
  }
  await walk(from, to);
  await fs.removeDir(from);
}
