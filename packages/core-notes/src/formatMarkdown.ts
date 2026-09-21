/** Inline formatting the editors offer (keyboard shortcuts on desktop, the bar above the phone keyboard). */
export type InlineFormat = "bold" | "italic" | "strike";

export const FORMAT_MARKER: Record<InlineFormat, string> = { bold: "**", italic: "*", strike: "~~" };

export interface FormatEdit {
  /** Replacements in original-text coordinates, in ascending order; none of them overlap. */
  changes: { from: number; to: number; insert: string }[];
  /** The selection to put back, in the coordinates of the text *after* the changes. */
  selection: { anchor: number; head: number };
}

const WORD = /[\p{L}\p{M}\p{N}_]/u;
const SPACE = /\s/;

const MARKER_CHAR = /[*~]/;

/**
 * Toggle `format` on the selection `[from, to)`: wrap it in Markdown markers, or take them off if it is already
 * wrapped. Leading/trailing spaces stay outside the markers (`** x**` would not render). With nothing selected it
 * formats the word at the cursor (the cursor stays where it was), or inserts an empty pair and puts the cursor between.
 *
 * Formats stack (`~~***word***~~`), so every `*` / `~` touching the text counts as one zone: a format is "on" if the
 * zone holds enough of its marker on both sides, and a new one goes on the outside of the zone.
 */
export function toggleFormat(text: string, from: number, to: number, format: InlineFormat): FormatEdit {
  const marker = FORMAT_MARKER[format];
  const m = marker.length;
  const cursor = to;
  let a = Math.min(from, to);
  let b = Math.max(from, to);
  while (a < b && SPACE.test(text[a]!)) a++;
  while (b > a && SPACE.test(text[b - 1]!)) b--;

  const collapsed = a === b;
  if (collapsed) {
    a = b = cursor;
    while (a > 0 && WORD.test(text[a - 1]!)) a--;
    while (b < text.length && WORD.test(text[b]!)) b++;
  }
  let l = a;
  while (l > 0 && MARKER_CHAR.test(text[l - 1]!)) l--;
  let r = b;
  while (r < text.length && MARKER_CHAR.test(text[r]!)) r++;

  const char = marker[0]!;
  const count = (start: number, end: number) => [...text.slice(start, end)].filter((c) => c === char).length;
  const around = Math.min(count(l, a), count(b, r));
  const on = format === "italic" ? around % 2 === 1 : around >= m;

  if (!on) {
    return {
      changes: [
        { from: l, to: l, insert: marker },
        { from: r, to: r, insert: marker },
      ],
      selection: collapsed ? { anchor: cursor + m, head: cursor + m } : { anchor: a + m, head: b + m },
    };
  }
  // Take `m` of the marker's characters off each side, outermost first.
  const removals: { from: number; to: number; insert: string }[] = [];
  for (let i = l, left = 0; i < a && left < m; i++) {
    if (text[i] === char) (removals.push({ from: i, to: i + 1, insert: "" }), left++);
  }
  const leftRemoved = removals.length;
  for (let i = r - 1, right = 0; i >= b && right < m; i--) {
    if (text[i] === char) (removals.push({ from: i, to: i + 1, insert: "" }), right++);
  }
  removals.sort((x, y) => x.from - y.from);
  return {
    changes: removals,
    selection: collapsed ? { anchor: cursor - leftRemoved, head: cursor - leftRemoved } : { anchor: a - leftRemoved, head: b - leftRemoved },
  };
}
