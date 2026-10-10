import test from "node:test";
import assert from "node:assert/strict";

// Mock localStorage for Node test environment
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => store.set(key, val),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};

import { getSavedPdfPage, savePdfPage, clearSavedPdfPage, pdfStorageKey, getPdfDark, setPdfDark } from "../src/pages/pdf/pdfState.ts";

test("pdfStorageKey formats key correctly", () => {
  assert.equal(pdfStorageKey("/path/to/doc.pdf"), "granite:pdf-page:/path/to/doc.pdf");
});

test("getSavedPdfPage returns null when nothing is saved", () => {
  localStorage.clear();
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), null);
});

test("savePdfPage saves page and getSavedPdfPage retrieves it", () => {
  localStorage.clear();
  savePdfPage("/path/to/doc.pdf", 42);
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), 42);
});

test("savePdfPage ignores non-positive page numbers", () => {
  localStorage.clear();
  savePdfPage("/path/to/doc.pdf", 0);
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), null);

  savePdfPage("/path/to/doc.pdf", -5);
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), null);
});

test("clearSavedPdfPage removes saved page", () => {
  localStorage.clear();
  savePdfPage("/path/to/doc.pdf", 10);
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), 10);

  clearSavedPdfPage("/path/to/doc.pdf");
  assert.equal(getSavedPdfPage("/path/to/doc.pdf"), null);
});

test("the dark PDF theme is off until chosen, then remembered", () => {
  localStorage.clear();
  assert.equal(getPdfDark(), false);
  setPdfDark(true);
  assert.equal(getPdfDark(), true);
  setPdfDark(false);
  assert.equal(getPdfDark(), false);
});

import {
  getPdfLayout,
  setPdfLayout,
  getPdfReadingMode,
  setPdfReadingMode,
  getPdfTypography,
  setPdfTypography,
  getSavedBookmarks,
  toggleBookmark,
  isBookmarked,
} from "../src/pages/pdf/pdfState.ts";

test("pdf layout defaults to spread and can be persisted", () => {
  localStorage.clear();
  assert.equal(getPdfLayout(), "spread");
  setPdfLayout("single");
  assert.equal(getPdfLayout(), "single");
  setPdfLayout("scroll");
  assert.equal(getPdfLayout(), "scroll");
});

test("pdf reading mode defaults to pages and can be toggled to reflow", () => {
  localStorage.clear();
  assert.equal(getPdfReadingMode(), "pages");
  setPdfReadingMode("reflow");
  assert.equal(getPdfReadingMode(), "reflow");
  setPdfReadingMode("pages");
  assert.equal(getPdfReadingMode(), "pages");
});

test("pdf typography preserves defaults and allows partial updates", () => {
  localStorage.clear();
  const def = getPdfTypography();
  assert.equal(def.font, "Georgia");
  assert.equal(def.fontSize, 100);
  assert.equal(def.lineHeight, 1.6);
  assert.equal(def.justify, true);

  setPdfTypography({ fontSize: 120, font: "Merriweather", justify: false });
  const updated = getPdfTypography();
  assert.equal(updated.fontSize, 120);
  assert.equal(updated.font, "Merriweather");
  assert.equal(updated.justify, false);
  assert.equal(updated.lineHeight, 1.6);
});

test("pdf bookmarks can be added, toggled, and queried", () => {
  localStorage.clear();
  const file = "test.pdf";
  assert.deepEqual(getSavedBookmarks(file), []);
  assert.equal(isBookmarked(file, 5), false);

  assert.equal(toggleBookmark(file, 5), true); // added
  assert.equal(isBookmarked(file, 5), true);
  assert.deepEqual(getSavedBookmarks(file), [5]);

  assert.equal(toggleBookmark(file, 2), true); // added
  assert.deepEqual(getSavedBookmarks(file), [2, 5]); // sorted

  assert.equal(toggleBookmark(file, 5), false); // removed
  assert.equal(isBookmarked(file, 5), false);
  assert.deepEqual(getSavedBookmarks(file), [2]);
});

