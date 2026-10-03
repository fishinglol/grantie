import { normalize } from "./path.ts";
import { relative } from "./relocateLinks.ts";

/**
 * Which text of a PDF page a link points at, the way Obsidian's PDF++ writes it: indexes into the page's text-layer
 * items (`textDivs`) and character offsets inside the first and last of them.
 */
export interface PdfSelection {
  beginIndex: number;
  beginOffset: number;
  endIndex: number;
  endOffset: number;
}

export interface PdfLinkTarget {
  /** Vault-relative path of the PDF. */
  path: string;
  page?: number;
  selection?: PdfSelection;
}

const encodePath = (p: string) =>
  p
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/\(/g, "%28").replace(/\)/g, "%29"))
    .join("/");

/** `[label](../Papers/a.pdf#page=3&selection=2,0,3,14)`, the path relative to the note's folder (`fromDir`, vault-relative, "" = root). */
export function buildPdfLink(o: { pdf: string; fromDir: string; page: number; selection?: PdfSelection; label: string }): string {
  const s = o.selection;
  const frag = `page=${o.page}` + (s ? `&selection=${s.beginIndex},${s.beginOffset},${s.endIndex},${s.endOffset}` : "");
  return `[${o.label.replace(/[[\]\\]/g, "\\$&")}](${encodePath(relative(o.fromDir, o.pdf))}#${frag})`;
}

const INT = /^\d+$/;

/** What a note's link address `url` (written in the folder `fromDir`) says about a PDF in the vault, or null when it is not one. */
export function parsePdfLink(url: string, fromDir: string): PdfLinkTarget | null {
  const hash = url.indexOf("#");
  const rawPath = hash < 0 ? url : url.slice(0, hash);
  if (!/\.pdf$/i.test(rawPath) || /^([a-z][a-z0-9+.-]*:|\/)/i.test(rawPath)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const path = normalize(fromDir ? `${fromDir}/${decoded}` : decoded);
  if (path === ".." || path.startsWith("../")) return null;
  const out: PdfLinkTarget = { path };
  if (hash < 0) return out;
  const params = new URLSearchParams(url.slice(hash + 1));
  const page = params.get("page");
  if (page && INT.test(page) && Number(page) >= 1) out.page = Number(page);
  const parts = params.get("selection")?.split(",");
  if (parts && parts.length === 4 && parts.every((n) => INT.test(n))) {
    const [beginIndex, beginOffset, endIndex, endOffset] = parts.map(Number) as [number, number, number, number];
    out.selection = { beginIndex, beginOffset, endIndex, endOffset };
  }
  return out;
}

export interface PdfBacklink {
  page: number;
  selection?: PdfSelection;
  /** The link's text. */
  label: string;
}

/** The links in a note (in folder `noteDir`) that point into the PDF at `pdf` (both vault-relative) and say a page. */
export function pdfBacklinks(text: string, noteDir: string, pdf: string): PdfBacklink[] {
  const out: PdfBacklink[] = [];
  for (const m of text.matchAll(/(?<!!)\[((?:[^\]\\]|\\.)*)\]\(\s*([^)\s]+)\s*\)/g)) {
    const t = parsePdfLink(m[2]!, noteDir);
    if (!t || t.path !== pdf || !t.page) continue;
    const label = m[1]!.replace(/\\([[\]\\])/g, "$1");
    out.push(t.selection ? { page: t.page, selection: t.selection, label } : { page: t.page, label });
  }
  return out;
}
