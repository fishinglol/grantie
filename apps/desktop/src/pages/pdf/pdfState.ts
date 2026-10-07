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
