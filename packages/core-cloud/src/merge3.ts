/**
 * Three-way merge of a text file by lines, like `git merge` on one file: `base` is what both devices last synced,
 * `ours` and `theirs` are the two edited versions. Returns the merged text, or null when both changed the same
 * lines differently (then the caller keeps both files instead). Pure, no IO.
 */

/** Lines `start..end` of the base (end exclusive) became `lines`; start === end is an insertion. */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** Above this many table cells the comparison is not attempted (a phone should not sit on a huge grid); the caller keeps both files. */
const MAX_CELLS = 4_000_000;

/** What `other` changed in `base`, as hunks in base coordinates; null when the comparison is too big. */
function diff(base: string[], other: string[]): Hunk[] | null {
  let head = 0;
  while (head < base.length && head < other.length && base[head] === other[head]) head++;
  let tail = 0;
  while (tail < base.length - head && tail < other.length - head && base[base.length - 1 - tail] === other[other.length - 1 - tail]) tail++;
  const a = base.slice(head, base.length - tail);
  const b = other.slice(head, other.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null;

  // lcs[i][j] = length of the longest common run of a[i..] and b[j..]
  const w = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
      open ??= { start: head + i, end: head + i, lines: [] };
      open.lines.push(b[j]!);
      j++;
    } else {
      open ??= { start: head + i, end: head + i, lines: [] };
      open.end = head + i + 1;
      i++;
    }
  }
  close();
  return hunks;
}

const same = (x: string[], y: string[]) => x.length === y.length && x.every((l, k) => l === y[k]);

/** Do two hunks touch the same base lines? Neighbouring lines are fine; an insertion is only in the way of a change that spans it. */
function clash(x: Hunk, y: Hunk): boolean {
  if (same(x.lines, y.lines) && x.start === y.start && x.end === y.end) return false; // both made the very same change
  if (x.start === x.end && y.start === y.end) return x.start === y.start;
  if (x.start === x.end) return y.start < x.start && x.start < y.end;
  if (y.start === y.end) return x.start < y.start && y.start < x.end;
  return x.start < y.end && y.start < x.end;
}

export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;
  const b = base.split("\n");
  const mine = diff(b, ours.split("\n"));
  const other = diff(b, theirs.split("\n"));
  if (!mine || !other) return null;
  for (const x of mine) for (const y of other) if (clash(x, y)) return null;

  const all = [...mine, ...other.filter((y) => !mine.some((x) => x.start === y.start && x.end === y.end && same(x.lines, y.lines)))];
  // An insertion and a change at the same place: the insertion goes first.
  all.sort((x, y) => x.start - y.start || x.end - y.end);
  const out: string[] = [];
  let at = 0;
  for (const h of all) {
    out.push(...b.slice(at, h.start), ...h.lines);
    at = h.end;
  }
  out.push(...b.slice(at));
  return out.join("\n");
}
