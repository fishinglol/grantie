import { noteTitle } from "./noteName.ts";

/**
 * Two plugin formats point at a note by its vault path: a ```popup card (`note: Folder/Note.md`) and a note cell in a
 * Simple Table (`[Title](note:Folder/Note.md)`, spaces and parentheses written %20 %28 %29). When a note is renamed or
 * moved (`from` -> `to`), or a whole folder is (`folder: true`, `from` / `to` are folder paths), this rewrites those
 * pointers in `text` so they follow it. Everything else in the text is left as it is.
 */
export function retargetNoteRefs(text: string, from: string, to: string, folder = false): string {
  if (from === to || !text.includes(folder ? basenameOf(from) : basenameOf(from).replace(/\.(md|markdown)$/i, ""))) return text;
  const moved = (path: string): string | null => {
    if (!folder) return path === from ? to : null;
    return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
  };
  const lines = text.split("\n");
  let inPopup = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      inPopup = !inPopup && /^```popup\s*$/.test(line);
      continue;
    }
    if (inPopup) {
      const m = /^(\s*note\s*:\s*)(.*?)(\s*)$/i.exec(line);
      const next = m && moved(m[2]!);
      if (m && next !== null) lines[i] = m[1]! + next + m[3]!;
    } else if (line.trimStart().startsWith("|")) {
      lines[i] = line.replace(/\[((?:[^\]\\]|\\.)*)\]\(((?:note:)?)([^)\s]+\.(?:md|markdown))\)/gi, (whole, title: string, scheme: string, url: string) => {
        if (!scheme && /^[a-z][a-z0-9+.-]*:|^\//i.test(url)) return whole; // an ordinary web / absolute link
        const path = url.replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")");
        const next = moved(path);
        if (next === null) return whole;
        const oldTitle = noteTitle(basenameOf(path));
        const shown = title.replace(/\\(.)/g, "$1") === oldTitle ? noteTitle(basenameOf(next)) : title.replace(/\\(.)/g, "$1");
        const encoded = next.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
        return `[${shown.replace(/[[\]\\]/g, "\\$&")}](note:${encoded})`;
      });
    }
  }
  return lines.join("\n");
}

const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
