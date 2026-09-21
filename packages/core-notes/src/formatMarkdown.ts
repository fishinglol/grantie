/** Inline formatting the editors offer (keyboard shortcuts on desktop, the bar above the phone keyboard). */
export type InlineFormat = "bold" | "italic" | "strike" | "underline";

export interface FormatEdit {
  /** Replacements in original-text coordinates, in ascending order; none of them overlap. */
  changes: { from: number; to: number; insert: string }[];
  /** The selection to put back, in the coordinates of the text *after* the changes. */
  selection: { anchor: number; head: number };
}

/** What goes before and after the text. Markdown has no underline, so it is the `<u>` tag (Obsidian does the same). */
const TOKENS: Record<InlineFormat, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  underline: { open: "<u>", close: "</u>" },
};

const WORD = /[\p{L}\p{M}\p{N}_]/u;
const SPACE = /\s/;
const MARKER_CHAR = /[*~]/;

/**
 * Toggle `format` on the selection `[from, to)`: wrap it in the format's markers, or take them off if it is already
 * wrapped. Leading/trailing spaces stay outside the markers (`** x**` would not render). With nothing selected it
 * formats the word at the cursor (the cursor stays where it was), or inserts an empty pair and puts the cursor between.
 *
 * Formats stack (`<u>~~***word***~~</u>`), so every `*`, `~` and `<u>` / `</u>` touching the text counts as one zone: a
 * format is "on" if the zone holds enough of its marker on both sides, and a new one goes on the outside of the zone.
 */
export function toggleFormat(text: string, from: number, to: number, format: InlineFormat): FormatEdit {
  const { open, close } = TOKENS[format];
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
  while (l > 0 && (MARKER_CHAR.test(text[l - 1]!) || (l >= 3 && text.slice(l - 3, l) === "<u>"))) l -= MARKER_CHAR.test(text[l - 1]!) ? 1 : 3;
  let r = b;
  while (r < text.length && (MARKER_CHAR.test(text[r]!) || text.startsWith("</u>", r))) r += MARKER_CHAR.test(text[r]!) ? 1 : 4;

  const before = text.slice(l, a);
  const after = text.slice(b, r);
  const count = (s: string, char: string) => [...s].filter((c) => c === char).length;
  let on: boolean;
  if (format === "underline") on = before.includes(open) && after.includes(close);
  else {
    const around = Math.min(count(before, open[0]!), count(after, open[0]!));
    on = format === "italic" ? around % 2 === 1 : around >= open.length;
  }

  if (!on) {
    const shift = open.length;
    return {
      changes: [
        { from: l, to: l, insert: open },
        { from: r, to: r, insert: close },
      ],
      selection: collapsed ? { anchor: cursor + shift, head: cursor + shift } : { anchor: a + shift, head: b + shift },
    };
  }

  // Take one set of markers off each side, outermost first.
  const removals: { from: number; to: number; insert: string }[] = [];
  if (format === "underline") {
    const openAt = text.indexOf(open, l);
    const closeAt = text.lastIndexOf(close, r - close.length);
    removals.push({ from: openAt, to: openAt + open.length, insert: "" }, { from: closeAt, to: closeAt + close.length, insert: "" });
  } else {
    const char = open[0]!;
    for (let i = l, n = 0; i < a && n < open.length; i++) if (text[i] === char) (removals.push({ from: i, to: i + 1, insert: "" }), n++);
    for (let i = r - 1, n = 0; i >= b && n < close.length; i--) if (text[i] === char) (removals.push({ from: i, to: i + 1, insert: "" }), n++);
    removals.sort((x, y) => x.from - y.from);
  }
  const leftRemoved = removals.filter((c) => c.to <= a).reduce((n, c) => n + (c.to - c.from), 0);
  return {
    changes: removals,
    selection: collapsed ? { anchor: cursor - leftRemoved, head: cursor - leftRemoved } : { anchor: a - leftRemoved, head: b - leftRemoved },
  };
}
