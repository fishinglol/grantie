import { basename, extname } from "./path.ts";

export interface EmbedImageInput {
  /** Current full text of the .md file. */
  content: string;
  /** The image being inserted. */
  image: {
    /** Original file name from the picker, e.g. "Screenshot 2026-08-31.png". */
    fileName: string;
    /** Raw bytes. Optional: omit when the caller only wants the markdown edit. */
    data?: Uint8Array;
  };
  /** Alt text; defaults to a slug of the file name. */
  altText?: string;
  /** Character offset in `content` to insert at; defaults to end of file. */
  insertAt?: number;
  /** Folder (relative to the note) that images are copied into. Default "assets". */
  assetsDirName?: string;
  /** Injectable clock for deterministic file names in tests. */
  now?: () => Date;
}

export interface EmbedImageResult {
  /** New file text with the image markdown inserted. */
  content: string;
  /** The markdown snippet that was inserted. */
  markdown: string;
  /** Path used in the markdown link, relative to the note, e.g. "assets/20260831-...-photo.png". */
  relativeSrc: string;
  /** The image write to perform, or null when no `data` was supplied. */
  write: { path: string; data: Uint8Array } | null;
}

/**
 * Pure. Given a note's text and an image, work out where the image file should
 * live (a sibling `assets/` folder), build the markdown reference, and splice it
 * into the text. Does NOT touch the filesystem — the returned `write` describes
 * the copy for a platform adapter to perform.
 */
export function embedImage(input: EmbedImageInput): EmbedImageResult {
  const assetsDir = input.assetsDirName ?? "assets";
  const stamp = formatStamp(input.now?.() ?? new Date());
  const ext = (extname(input.image.fileName) || ".png").toLowerCase();
  const stem = basename(input.image.fileName).slice(0, ext.length ? -ext.length : undefined);
  const slug = slugify(stem) || "image";

  const fileName = `${stamp}-${slug}${ext}`;
  const relativeSrc = `${assetsDir}/${fileName}`;
  const alt = input.altText ?? slug;
  const markdown = `![${alt}](${relativeSrc})`;

  const { content } = input;
  const at = clamp(input.insertAt ?? content.length, 0, content.length);
  const before = content.slice(0, at);
  const after = content.slice(at);

  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" ? "\n" : after.startsWith("\n") ? "\n" : "\n\n";

  return {
    content: `${before}${lead}${markdown}${trail}${after}`,
    markdown,
    relativeSrc,
    write: input.image.data ? { path: relativeSrc, data: input.image.data } : null,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function formatStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
