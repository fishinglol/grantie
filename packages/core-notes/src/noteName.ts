const NOTE_EXT = /\.(md|markdown)$/i;

/** A note's name as people see it: the file name without `.md`. */
export const noteTitle = (fileName: string): string => fileName.replace(NOTE_EXT, "");

/**
 * The file name a note gets when its title is edited to `title`: same extension, characters a file name can't
 * hold replaced, and no leading dot (that would hide it). `null` when there is nothing to rename to
 * (empty title, or the name would not change).
 */
export function renamedNoteFile(oldFile: string, title: string): string | null {
  const ext = NOTE_EXT.exec(oldFile)?.[0] ?? ".md";
  const stem = noteTitle(title.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "").trim()).trim();
  if (!stem) return null;
  const next = stem + ext;
  return next === oldFile ? null : next;
}
