const KEY_PREFIX = "granite:pdf-page:";

/** Key used in localStorage for a PDF file's last read page. */
export function pdfStorageKey(file: string): string {
  return `${KEY_PREFIX}${file}`;
}

/** Get the last read page for a PDF file, or null if none saved. */
export function getSavedPdfPage(file: string): number | null {
  try {
    const raw = localStorage.getItem(pdfStorageKey(file));
    if (!raw) return null;
    const page = parseInt(raw, 10);
    return Number.isFinite(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

/** Save the last read page for a PDF file. */
export function savePdfPage(file: string, page: number): void {
  try {
    const p = Math.floor(page);
    if (p > 0) {
      localStorage.setItem(pdfStorageKey(file), String(p));
    }
  } catch {
    // ignore quota or security errors
  }
}

/** Clear saved read page for a PDF file. */
export function clearSavedPdfPage(file: string): void {
  try {
    localStorage.removeItem(pdfStorageKey(file));
  } catch {
    // ignore
  }
}

const DARK_KEY = "granite:pdf-dark";

/** Whether PDFs are shown in the dark theme. One choice for every PDF. */
export function getPdfDark(): boolean {
  try {
    return localStorage.getItem(DARK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPdfDark(dark: boolean): void {
  try {
    localStorage.setItem(DARK_KEY, dark ? "1" : "0");
  } catch {
    // ignore quota or security errors
  }
}

export type PdfLayoutMode = "single" | "spread" | "scroll";
export type PdfReadingMode = "pages" | "reflow";

export interface PdfTypography {
  font: string;
  fontSize: number;
  lineHeight: number;
  justify: boolean;
}

export const DEFAULT_TYPOGRAPHY: PdfTypography = {
  font: "Georgia",
  fontSize: 100,
  lineHeight: 1.6,
  justify: true,
};

const LAYOUT_KEY = "granite:pdf-layout";

/** The layout mode (single page, two-page spread, or continuous scroll). Defaults to spread. */
export function getPdfLayout(): PdfLayoutMode {
  try {
    const val = localStorage.getItem(LAYOUT_KEY);
    if (val === "single" || val === "spread" || val === "scroll") return val;
  } catch {
    // ignore
  }
  return "spread";
}

export function setPdfLayout(layout: PdfLayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // ignore
  }
}

const READING_MODE_KEY = "granite:pdf-reading-mode";

/** Whether the viewer renders original PDF vector pages or reflowed book text. */
export function getPdfReadingMode(): PdfReadingMode {
  try {
    const val = localStorage.getItem(READING_MODE_KEY);
    if (val === "pages" || val === "reflow") return val;
  } catch {
    // ignore
  }
  return "pages";
}

export function setPdfReadingMode(mode: PdfReadingMode): void {
  try {
    localStorage.setItem(READING_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

const TYPO_KEY = "granite:pdf-typography";

/** Typography settings for the reflow book reader. */
export function getPdfTypography(): PdfTypography {
  try {
    const raw = localStorage.getItem(TYPO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_TYPOGRAPHY, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_TYPOGRAPHY;
}

export function setPdfTypography(typo: Partial<PdfTypography>): void {
  try {
    const current = getPdfTypography();
    localStorage.setItem(TYPO_KEY, JSON.stringify({ ...current, ...typo }));
  } catch {
    // ignore
  }
}

const BOOKMARKS_PREFIX = "granite:pdf-bookmarks:";

export function pdfBookmarksKey(file: string): string {
  return `${BOOKMARKS_PREFIX}${file}`;
}

/** Get list of saved bookmark page numbers for a PDF file. */
export function getSavedBookmarks(file: string): number[] {
  try {
    const raw = localStorage.getItem(pdfBookmarksKey(file));
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      return list.filter((n) => typeof n === "number" && n > 0).sort((a, b) => a - b);
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveBookmarks(file: string, pages: number[]): void {
  try {
    const sorted = [...new Set(pages.filter((n) => typeof n === "number" && n > 0))].sort((a, b) => a - b);
    localStorage.setItem(pdfBookmarksKey(file), JSON.stringify(sorted));
  } catch {
    // ignore
  }
}

/** Toggle a bookmark on/off for a page, returning whether it is now bookmarked. */
export function toggleBookmark(file: string, page: number): boolean {
  const current = getSavedBookmarks(file);
  const exists = current.includes(page);
  const next = exists ? current.filter((p) => p !== page) : [...current, page];
  saveBookmarks(file, next);
  return !exists;
}

/** Check if a page is bookmarked. */
export function isBookmarked(file: string, page: number): boolean {
  return getSavedBookmarks(file).includes(page);
}

