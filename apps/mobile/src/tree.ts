/** Helpers for the vault's folder tree. Paths are relative to the vault, "/"-separated. */

export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export interface TreeRow {
  kind: 'folder' | 'note';
  /** Path relative to the vault. */
  rel: string;
  depth: number;
  open: boolean;
}

/** Every folder in tree order (a folder, then its subfolders), with its depth. */
export function folderOrder(folders: string[], dir = '', depth = 0): { rel: string; depth: number }[] {
  return folders
    .filter((f) => parentOf(f) === dir)
    .flatMap((f) => [{ rel: f, depth }, ...folderOrder(folders, f, depth + 1)]);
}

/** The rows the sidebar shows, top to bottom: folders first, then notes, skipping collapsed folders. */
export function visibleRows(notes: string[], folders: string[], collapsed: ReadonlySet<string>, dir = '', depth = 0): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const folder of folders.filter((f) => parentOf(f) === dir)) {
    const open = !collapsed.has(folder);
    rows.push({ kind: 'folder', rel: folder, depth, open });
    if (open) rows.push(...visibleRows(notes, folders, collapsed, folder, depth + 1));
  }
  for (const note of notes.filter((n) => parentOf(n) === dir)) rows.push({ kind: 'note', rel: note, depth, open: false });
  return rows;
}
