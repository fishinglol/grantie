/**
 * Tiny path helpers. Pure, no `node:path` dependency so this stays usable inside
 * React Native and Tauri webviews. Operates on "/"-separated paths and tolerates
 * a leading URI scheme (`file:///…`, `content://…`) so it works with the URIs
 * that Expo / Tauri hand back. Markdown links always use "/".
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function splitScheme(p: string): [scheme: string, rest: string] {
  const m = SCHEME.exec(p);
  return m ? [m[0], p.slice(m[0].length)] : ["", p];
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
  const body = [first, ...segs.slice(1)].join("/").replace(/\/{2,}/g, "/");
  return scheme + body;
}
