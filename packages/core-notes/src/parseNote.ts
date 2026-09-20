import type { Frontmatter, FrontmatterValue, Heading, ImageRef, LinkRef, ParsedNote } from "./types.ts";

/**
 * Parse raw markdown text into a structured {@link ParsedNote}.
 *
 * Pure function: text in, data out. No filesystem, no UI, no platform APIs.
 * This is NOT a full CommonMark renderer — it extracts the metadata Granite
 * needs (frontmatter, headings, image/link references, word count). Rich
 * rendering stays in each app's UI layer with a standard markdown library.
 */
export function parseNote(raw: string): ParsedNote {
  const { data, body } = splitFrontmatter(raw);
  const lines = body.split(/\r?\n/);

  const headings: Heading[] = [];
  const images: ImageRef[] = [];
  const links: LinkRef[] = [];

  let fenceMarker: string | null = null;

  lines.forEach((line, idx) => {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1]![0]!;
      if (fenceMarker === null) fenceMarker = marker;
      else if (marker === fenceMarker) fenceMarker = null;
      return;
    }
    if (fenceMarker !== null) return;

    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) headings.push({ level: h[1]!.length, text: h[2]!.trim(), line: idx });

    // Blank out inline code spans so `![](x)` / `[](x)` written as code isn't
    // mistaken for a real image or link.
    const scan = line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));

    const imgRe = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
    for (let m = imgRe.exec(scan); m; m = imgRe.exec(scan)) {
      const src = unwrap(m[2]!);
      images.push({ alt: m[1] ?? "", src, line: idx, isLocal: !/^(https?:|data:)/i.test(src) });
    }

    const linkRe = /(^|[^!])\[([^\]]+)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
    for (let m = linkRe.exec(scan); m; m = linkRe.exec(scan)) {
      const href = unwrap(m[3]!);
      links.push({ text: m[2]!, href, line: idx, isExternal: /^(https?:|mailto:)/i.test(href) });
    }
  });

  const fmTitle = typeof data.title === "string" && data.title.length > 0 ? data.title : null;
  const title = fmTitle ?? headings.find((x) => x.level === 1)?.text ?? null;

  const wordCount = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_~`|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  return { frontmatter: data, body, title, headings, images, links, wordCount };
}

function unwrap(s: string): string {
  return s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
}

// --- frontmatter -----------------------------------------------------------

/** Split a leading `---` YAML frontmatter block from the body. */
export function splitFrontmatter(raw: string): { data: Frontmatter; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  return { data: parseSimpleYaml(m[1]!), body: raw.slice(m[0].length) };
}

/**
 * Minimal YAML: `key: value`, block lists (`- item`), inline lists (`[a, b]`),
 * quoted strings, numbers, booleans, null. Enough for note frontmatter; not a
 * spec-compliant YAML parser.
 */
function parseSimpleYaml(text: string): Frontmatter {
  const out: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      const existing = out[currentKey];
      const arr = Array.isArray(existing) ? existing : (out[currentKey] = []);
      arr.push(parseScalar(item[1]!) as string | number | boolean | null);
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1]!;
      const rest = kv[2]!.trim();
      if (rest === "") {
        out[currentKey] = null; // a block list may follow on later lines
      } else {
        out[currentKey] = parseScalar(rest);
        currentKey = null;
      }
    }
  }
  return out;
}

function parseScalar(sRaw: string): FrontmatterValue {
  const s = sRaw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => parseScalar(x) as string | number | boolean | null);
  }
  return s;
}
