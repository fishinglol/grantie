/**
 * Tiny path helpers. Pure, no `node:path` dependency so this stays usable inside
 * React Native and Tauri webviews. Operates on "/"-separated paths and tolerates
 * a leading URI scheme (`file:///…`, `content://…`) so it works with the URIs
 * that Expo / Tauri hand back. Markdown links always use "/".
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** A Windows drive root once through `toPosix`: `C:/`. Handled like a scheme, so `dirname("C:/a.md")` is `C:/`. */
const DRIVE = /^[a-z]:\//i;

function splitScheme(p: string): [scheme: string, rest: string] {
  const m = SCHEME.exec(p) ?? DRIVE.exec(p);
  return m ? [m[0], p.slice(m[0].length)] : ["", p];
}

/**
 * A Windows path (`C:\Users\f\Vault`, `\\server\share`) as a `/` path, which is all the rest of the app understands and
 * which Windows accepts. Every path Tauri hands the page (folder dialog, dropped files, `documentDir`) goes through this.
 * Anything else is returned as is: a macOS/Linux folder name may contain a backslash.
 */
export function toPosix(p: string): string {
  return /^[a-z]:[\\/]|^\\\\/i.test(p) ? p.replace(/\\/g, "/") : p;
}

export function dirname(p: string): string {
  const [scheme, rest] = splitScheme(p);
  const norm = rest.replace(/\/+$/, "");
  const i = norm.lastIndexOf("/");
  if (i < 0) return scheme ? scheme : ".";
  if (i === 0) return scheme ? `${scheme}/` : "/";
  return scheme + norm.slice(0, i);
}

export function basename(p: string): string {
  const norm = splitScheme(p)[1].replace(/\/+$/, "");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
}

export function join(...parts: Array<string | undefined | null>): string {
  const segs = parts.filter((s): s is string => !!s && s.length > 0);
  if (segs.length === 0) return ".";
  const [scheme, first] = splitScheme(segs[0]!);
  const body = [first, ...segs.slice(1)].filter(Boolean).join("/").replace(/\/{2,}/g, "/");
  return scheme + body;
}

/**
 * `a/b/../c/./d` → `a/c/d`. A file URL with `..` in it is refused by Tauri's asset protocol, so a note in a
 * subfolder linking `../assets/x.png` drew a broken image. `..` above the start of a relative path is kept.
 */
export function normalize(p: string): string {
  const [scheme, rest] = splitScheme(p);
  const drive = DRIVE.test(scheme);
  const absolute = drive || rest.startsWith("/");
  const out: string[] = [];
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else if (seg !== ".." || !absolute) out.push(seg);
  }
  return scheme + (absolute && !drive ? "/" : "") + out.join("/");
}
