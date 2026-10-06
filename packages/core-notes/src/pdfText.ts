/**
 * Pure text extraction helpers for PDF pages (pdf.js TextContent).
 *
 * This module is platform-neutral: it takes raw data from pdf.js and returns
 * plain strings. It has no imports from pdfjs-dist so that core-notes stays
 * dependency-free; the caller passes already-fetched TextItem arrays.
 *
 * Used by:
 *   - apps/mobile PdfScreen (text reader)
 *   - apps/desktop pdf viewer (planned, phase 2)
 */

export interface TextItem {
  /** The text string of this item. */
  str: string;
  /**
   * Transform matrix [a, b, c, d, e, f].  We only need `e` (x) and `f` (y)
   * for line grouping.
   */
  transform: number[];
  /** Character width; used to detect word spacing. */
  width: number;
}

export interface PdfLine {
  /** Concatenated text of all items on this visual line. */
  text: string;
  /** The y-coordinate (transform[5]) of the first item on the line. */
  y: number;
}

export interface PdfParagraph {
  /** Lines of the paragraph, already joined with spaces / hyphens resolved. */
  text: string;
}

export interface PdfPageText {
  /** 1-based page number, preserved for phase-2 back-links. */
  page: number;
  paragraphs: PdfParagraph[];
  /** True when the page produced zero text items — likely a scanned image. */
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Group TextItems into visual lines by their y coordinate. */
function groupLines(items: TextItem[]): PdfLine[] {
  if (items.length === 0) return [];

  // Cluster by y value within a tolerance (half of a typical line height ≈ 3 pt).
  const TOLERANCE = 3;
  const lines: PdfLine[] = [];
  let currentY = items[0]!.transform[5]!;
  let currentParts: string[] = [];

  for (const item of items) {
    const y = item.transform[5]!;
    if (Math.abs(y - currentY) > TOLERANCE) {
      // New line: flush current
      lines.push({ text: currentParts.join(''), y: currentY });
      currentY = y;
      currentParts = [];
    }
    currentParts.push(item.str);
  }
  if (currentParts.length > 0) {
    lines.push({ text: currentParts.join(''), y: currentY });
  }

  // pdf.js gives items in natural reading order but y grows downward in screen
  // space while the PDF coordinate system has y growing upward.  Sort descending
  // by y so the first line in the PDF (largest y value) comes first.
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/** Join lines into paragraphs, resolving soft hyphens at line-ends. */
function joinParagraphs(lines: PdfLine[]): PdfParagraph[] {
  if (lines.length === 0) return [];

  // A "large gap" between consecutive y values signals a paragraph break.
  // We estimate a typical line height from the median y-delta.
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    deltas.push(Math.abs(lines[i - 1]!.y - lines[i]!.y));
  }
  deltas.sort((a, b) => a - b);
  // We want the *typical* line height, not the median — paragraph gaps skew the
  // median upward.  The minimum non-zero delta approximates a single line step.
  const lineHeight = deltas.length === 0 ? 12 : (deltas[0] ?? 12);
  // A gap more than 2× the typical line height = paragraph break.
  const PARA_GAP = lineHeight * 2;

  const paragraphs: PdfParagraph[] = [];
  let paraLines: string[] = [];
  // When the previous line ended with a soft hyphen, this holds the de-hyphenated
  // prefix so the next word is appended directly (no space).
  let hyphenPrefix = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // If the previous line was hyphenated, merge directly.
    const raw = hyphenPrefix + line.text;
    hyphenPrefix = '';

    const nextLine = lines[i + 1];
    const gap = nextLine ? Math.abs(line.y - nextLine.y) : Infinity;
    const isParaBreak = gap > PARA_GAP;

    // Detect soft hyphen: trailing "word-" AND the gap is a normal line step.
    const isSoftHyphen = !isParaBreak && nextLine != null && gap <= lineHeight * 1.1 && /\p{L}-$/u.test(raw);

    if (isSoftHyphen) {
      // Defer the de-hyphenated prefix to be prepended to the next line.
      hyphenPrefix = raw.slice(0, -1);
    } else {
      paraLines.push(raw);
      if (isParaBreak || i === lines.length - 1) {
        const text = paraLines.join(' ').trim();
        if (text) paragraphs.push({ text });
        paraLines = [];
      }
    }
  }
  return paragraphs;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert one page's TextContent items (from `page.getTextContent()`) into
 * structured paragraphs suitable for a reflowed text reader.
 *
 * @param page  1-based page number.
 * @param items The `items` array from pdf.js `TextContent` (only items where
 *              `str` is non-empty are used; `MarkedContent` markers are ignored).
 */
export function extractPageText(page: number, items: TextItem[]): PdfPageText {
  // Filter to real text items (pdf.js also emits MarkedContent markers which
  // have no `transform`).
  const textItems = items.filter((it) => it.str !== '' && Array.isArray(it.transform));

  if (textItems.length === 0) {
    return { page, paragraphs: [], empty: true };
  }

  const lines = groupLines(textItems);
  const paragraphs = joinParagraphs(lines);
  return { page, paragraphs, empty: paragraphs.length === 0 };
}
