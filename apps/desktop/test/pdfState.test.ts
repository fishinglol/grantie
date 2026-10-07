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
