import { join } from '@granite/core-notes';
import type { MovableFs } from './expoFs';

/**
 * Which note belongs to which PDF (vault-relative paths), kept in `.granite/pdf-notes.json`: that folder is synced, so
 * the phone and the desktop agree, and a note the user renamed is still the one the PDF's note button opens.
 */
const FILE = '.granite/pdf-notes.json';

export async function readPdfNotes(fs: MovableFs, vaultDir: string): Promise<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(await fs.readTextFile(join(vaultDir, FILE)));
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {}; // no file yet, or one that is not readable: the default name is used
  }
}

async function write(fs: MovableFs, vaultDir: string, map: Record<string, string>) {
  await fs.mkdirp(join(vaultDir, '.granite'));
  await fs.writeTextFile(join(vaultDir, FILE), JSON.stringify(map, null, 2));
}

/** The PDF's note is `noteRel`. */
export async function rememberPdfNote(fs: MovableFs, vaultDir: string, pdfRel: string, noteRel: string) {
  const map = await readPdfNotes(fs, vaultDir);
  if (map[pdfRel] === noteRel) return;
  await write(fs, vaultDir, { ...map, [pdfRel]: noteRel });
}

/** A PDF or a note was renamed or moved from `from` to `to`: the pairs that mention it follow. */
export async function followPdfNote(fs: MovableFs, vaultDir: string, from: string, to: string) {
  const map = await readPdfNotes(fs, vaultDir);
  const next: Record<string, string> = {};
  let changed = false;
  for (const [pdf, note] of Object.entries(map)) {
    const key = pdf === from ? to : pdf;
    const value = note === from ? to : note;
    if (key !== pdf || value !== note) changed = true;
    next[key] = value;
  }
  if (changed) await write(fs, vaultDir, next);
}
