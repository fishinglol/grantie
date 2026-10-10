import { join } from '@granite/core-notes';
import type { MovableFs } from './expoFs';

/**
 * Which note belongs to which PDF (vault-relative paths), kept in `.granite/pdf-notes.json`: that folder is synced, so
 * the phone and the desktop agree, and a note the user renamed is still the one the PDF's note button opens.
 */
const FILE = '.granite/pdf-notes.json';
const BOOKMARKS_FILE = '.granite/pdf-bookmarks.json';

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

/** Returns the currently linked note for `pdfRel` if it exists on disk, else null. */
export async function getLinkedPdfNote(fs: MovableFs, vaultDir: string, pdfRel: string): Promise<string | null> {
  const map = await readPdfNotes(fs, vaultDir);
  const noteRel = map[pdfRel];
  if (noteRel && (await fs.exists(join(vaultDir, noteRel)))) {
    return noteRel;
  }
  return null;
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

/** Read persisted bookmarks for all PDFs. */
export async function readPdfBookmarks(fs: MovableFs, vaultDir: string): Promise<Record<string, number[]>> {
  try {
    const raw: unknown = JSON.parse(await fs.readTextFile(join(vaultDir, BOOKMARKS_FILE)));
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        result[k] = v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Save bookmarks for a given PDF. */
export async function rememberPdfBookmarks(fs: MovableFs, vaultDir: string, pdfRel: string, bookmarks: number[]) {
  const map = await readPdfBookmarks(fs, vaultDir);
  const sorted = Array.from(new Set(bookmarks)).sort((a, b) => a - b);
  await fs.mkdirp(join(vaultDir, '.granite'));
  await fs.writeTextFile(join(vaultDir, BOOKMARKS_FILE), JSON.stringify({ ...map, [pdfRel]: sorted }, null, 2));
}

/** Toggles bookmark on a page for `pdfRel` and returns updated list of bookmarks. */
export async function togglePdfBookmark(fs: MovableFs, vaultDir: string, pdfRel: string, page: number): Promise<number[]> {
  const map = await readPdfBookmarks(fs, vaultDir);
  const current = map[pdfRel] || [];
  const next = current.includes(page) ? current.filter((p) => p !== page) : [...current, page].sort((a, b) => a - b);
  await rememberPdfBookmarks(fs, vaultDir, pdfRel, next);
  return next;
}

const PAGES_FILE = '.granite/pdf-pages.json';
const LAST_OPEN_FILE = '.granite/last-open.json';

/** Read persisted last read pages for all PDFs: Record<pdfRel, pageNumber>. */
export async function readPdfPages(fs: MovableFs, vaultDir: string): Promise<Record<string, number>> {
  try {
    const raw: unknown = JSON.parse(await fs.readTextFile(join(vaultDir, PAGES_FILE)));
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        result[k] = Math.round(v);
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Save last read page for a given PDF. */
export async function rememberPdfPage(fs: MovableFs, vaultDir: string, pdfRel: string, page: number) {
  if (!Number.isFinite(page) || page < 1) return;
  const p = Math.round(page);
  const map = await readPdfPages(fs, vaultDir);
  if (map[pdfRel] === p) return;
  await fs.mkdirp(join(vaultDir, '.granite'));
  await fs.writeTextFile(join(vaultDir, PAGES_FILE), JSON.stringify({ ...map, [pdfRel]: p }, null, 2));
}

/** Get last read page for `pdfRel` or null. */
export async function getPdfSavedPage(fs: MovableFs, vaultDir: string, pdfRel: string): Promise<number | null> {
  const map = await readPdfPages(fs, vaultDir);
  return map[pdfRel] ?? null;
}

/** A PDF was renamed or moved: update saved page mapping. */
export async function followPdfPage(fs: MovableFs, vaultDir: string, from: string, to: string) {
  const map = await readPdfPages(fs, vaultDir);
  if (!(from in map)) return;
  const next = { ...map, [to]: map[from]! };
  delete next[from];
  await fs.mkdirp(join(vaultDir, '.granite'));
  await fs.writeTextFile(join(vaultDir, PAGES_FILE), JSON.stringify(next, null, 2));
}

/** A PDF was renamed or moved: update bookmarks mapping. */
export async function followPdfBookmarks(fs: MovableFs, vaultDir: string, from: string, to: string) {
  const map = await readPdfBookmarks(fs, vaultDir);
  if (!(from in map)) return;
  const next = { ...map, [to]: map[from]! };
  delete next[from];
  await fs.mkdirp(join(vaultDir, '.granite'));
  await fs.writeTextFile(join(vaultDir, BOOKMARKS_FILE), JSON.stringify(next, null, 2));
}

/** Remembers the last open file (relative path to vault: note, canvas, or pdf). */
export async function rememberLastOpenFile(fs: MovableFs, vaultDir: string, rel: string | null) {
  try {
    await fs.mkdirp(join(vaultDir, '.granite'));
    if (!rel) {
      if (await fs.exists(join(vaultDir, LAST_OPEN_FILE))) {
        await fs.writeTextFile(join(vaultDir, LAST_OPEN_FILE), JSON.stringify({ file: null }));
      }
      return;
    }
    await fs.writeTextFile(join(vaultDir, LAST_OPEN_FILE), JSON.stringify({ file: rel }));
  } catch {
    // ignore
  }
}

/** Returns the last opened file path relative to vault, or null. */
export async function readLastOpenFile(fs: MovableFs, vaultDir: string): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readTextFile(join(vaultDir, LAST_OPEN_FILE)));
    if (raw && typeof raw === 'object' && typeof (raw as any).file === 'string') {
      const file = (raw as any).file;
      if (await fs.exists(join(vaultDir, file))) {
        return file;
      }
    }
    return null;
  } catch {
    return null;
  }
}
