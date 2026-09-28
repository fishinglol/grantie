/** A piece of TeX in a note: `$…$` inside a line, `$$…$$` on its own (and may span lines). Positions are in the text given. */
export interface MathSpan {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/**
 * Finds math the way Obsidian (and Pandoc) do. `$$…$$` is display math and may cross lines. `$…$` is inline math on one line:
 * the opening `$` is not followed by a space, the closing one is not preceded by a space nor followed by a digit, so prices
 * ("$5 and $10") stay text. `\$` is a literal dollar sign. Code is not excluded here; the editor skips spans inside code.
 */
export function findMath(text: string): MathSpan[] {
  const out: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "$") {
      i++;
      continue;
    }
    if (text[i + 1] === "$") {
      const end = closing(text, i + 2, "$$", true);
      if (end > i + 2 && text.slice(i + 2, end).trim()) {
        out.push({ from: i, to: end + 2, tex: text.slice(i + 2, end).trim(), display: true });
        i = end + 2;
      } else i += 2;
      continue;
    }
    const end = closing(text, i + 1, "$", false);
    const tex = end > 0 ? text.slice(i + 1, end) : "";
    if (tex && !/^\s/.test(tex) && !/\s$/.test(tex) && !/\d/.test(text[end + 1] ?? "")) {
      out.push({ from: i, to: end + 1, tex, display: false });
      i = end + 1;
    } else i++;
  }
  return out;
}

/** Index of the closing delimiter at or after `from` (skipping `\x` escapes), or -1. Inline math stops at a line break. */
function closing(text: string, from: number, delim: "$" | "$$", crossLines: boolean): number {
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "\n" && !crossLines) return -1;
    if (text.startsWith(delim, j) && (delim === "$$" || text[j + 1] !== "$")) return j;
  }
  return -1;
}
