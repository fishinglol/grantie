const RELATIVE_LINK = /(!?\[[^\]]*\]\(\s*)([^)\s]+)/g;
const HAS_SCHEME = /^([a-z][a-z0-9+.-]*:|\/|#)/i;

function segments(path: string): string[] {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out;
}

function relative(fromDir: string, target: string): string {
  const a = segments(fromDir);
  const b = segments(target);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/**
 * Links like `![](assets/x.png)` or `[file](assets/x.pdf)` are relative to the
 * note's own folder, so moving a note from `oldDir` to `newDir` means rewriting
 * them to keep pointing at the same files. URLs, anchors and absolute paths are
 * left alone.
 */
export function relocateLinks(
  text: string,
  oldDir: string,
  newDir: string,
  /** When a whole folder moved, links into that folder travel with it and are left as they are. */
  movedFolder?: { from: string },
): string {
  if (oldDir === newDir) return text;
  const inside = movedFolder ? segments(movedFolder.from) : null;
  return text.replace(RELATIVE_LINK, (match, head: string, url: string) => {
    if (HAS_SCHEME.test(url)) return match;
    const target = `${oldDir}/${url}`;
    if (inside && inside.every((seg, i) => segments(target)[i] === seg)) return match;
    return head + relative(newDir, target);
  });
}
