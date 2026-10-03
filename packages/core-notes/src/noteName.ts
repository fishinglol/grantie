/** Notes, and canvases (which the sidebar lists and renames the same way). */
const NOTE_EXT = /\.(md|markdown|canvas)$/i;

/** A note's name as people see it: the file name without `.md` (or `.canvas`). */
export const noteTitle = (fileName: string): string => fileName.replace(NOTE_EXT, "");

/**
 * Windows can't create a file named like a device (`CON`, `NUL`, `COM1`… with or without an extension), and drops a
 * trailing dot or space. A vault is meant to open on every device, so a name like that is changed everywhere.
 */
export function windowsSafe(name: string): string {
  const trimmed = name.replace(/[. ]+$/, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed) ? `_${trimmed}` : trimmed;
}

/**
 * The file name a note gets when its title is edited to `title`: same extension, characters a file name can't
 * hold replaced, and no leading dot (that would hide it). `null` when there is nothing to rename to
 * (empty title, or the name would not change).
 */
export function renamedNoteFile(oldFile: string, title: string): string | null {
  // A PDF is listed with its extension, so the name typed for it may carry `.pdf` already.
  const pdf = /\.pdf$/i.test(oldFile);
  const ext = pdf ? ".pdf" : (NOTE_EXT.exec(oldFile)?.[0] ?? ".md");
  const typed = title.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "").trim();
  const stem = windowsSafe((pdf ? typed.replace(/\.pdf$/i, "") : noteTitle(typed)).trim());
  if (!stem) return null;
  const next = stem + ext;
  return next === oldFile ? null : next;
}
