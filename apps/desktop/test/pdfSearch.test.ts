import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPageText, searchPdfText } from "../src/pages/pdf/pdfSearch.ts";

describe("buildPageText", () => {
  it("returns empty string for empty items", () => {
    assert.equal(buildPageText([]), "");
  });

  it("joins kerning fragments without spaces", () => {
    const items = [
      { str: "wh", transform: [12, 0, 0, 12, 50, 250], width: 14, hasEOL: false },
      { str: "at", transform: [12, 0, 0, 12, 64, 250], width: 14, hasEOL: false },
    ];
    assert.equal(buildPageText(items), "what");
  });

  it("inserts space between items with horizontal gap", () => {
    const items = [
      { str: "what", transform: [12, 0, 0, 12, 50, 250], width: 28, hasEOL: false },
      { str: "sticks", transform: [12, 0, 0, 12, 85, 250], width: 35, hasEOL: false },
    ];
    assert.equal(buildPageText(items), "what sticks");
  });

  it("handles items with existing trailing space without double spacing", () => {
    const items = [
      { str: "what ", transform: [12, 0, 0, 12, 50, 250], width: 32, hasEOL: false },
      { str: "sticks", transform: [12, 0, 0, 12, 85, 250], width: 35, hasEOL: false },
    ];
    assert.equal(buildPageText(items), "what sticks");
  });

  it("inserts newline on hasEOL or line change", () => {
    const items = [
      { str: "Line 1", transform: [12, 0, 0, 12, 50, 250], width: 35, hasEOL: true },
      { str: "Line 2", transform: [12, 0, 0, 12, 50, 230], width: 35, hasEOL: false },
    ];
    assert.equal(buildPageText(items), "Line 1\nLine 2");
  });
});

describe("searchPdfText", () => {
  const createMockDoc = (pages: Record<number, any[]>) => {
    const pageNums = Object.keys(pages).map(Number);
    return {
      numPages: pageNums.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages[n] ?? [] }),
        cleanup: () => {},
      }),
    };
  };

  it("finds matches across kerning fragments and returns snippets", async () => {
    const doc = createMockDoc({
      1: [
        { str: "wh", transform: [12, 0, 0, 12, 50, 250], width: 14, hasEOL: false },
        { str: "at", transform: [12, 0, 0, 12, 64, 250], width: 14, hasEOL: false },
        { str: "sticks in this book", transform: [12, 0, 0, 12, 85, 250], width: 80, hasEOL: false },
      ],
      2: [
        { str: "Other content", transform: [12, 0, 0, 12, 50, 250], width: 60, hasEOL: false },
      ],
    });

    const results = await searchPdfText(doc, "what");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.page, 1);
    assert.equal(results[0]!.snippetMatch.toLowerCase(), "what");
    assert.ok(results[0]!.snippetAfter.includes("sticks"));
  });

  it("handles case-insensitivity and Unicode normalization", async () => {
    const doc = createMockDoc({
      1: [
        { str: "What makes urban legends so compelling?", transform: [12, 0, 0, 12, 50, 250], width: 200, hasEOL: false },
      ],
    });

    const results = await searchPdfText(doc, "what");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.snippetMatch, "What");
  });

  it("supports progressive result callback", async () => {
    const doc = createMockDoc({
      1: [{ str: "what page 1", transform: [12, 0, 0, 12, 50, 250], width: 60, hasEOL: false }],
      2: [{ str: "what page 2", transform: [12, 0, 0, 12, 50, 250], width: 60, hasEOL: false }],
    });

    const streamed: number[] = [];
    const results = await searchPdfText(
      doc,
      "what",
      undefined,
      undefined,
      (matches) => streamed.push(matches.length),
    );

    assert.equal(results.length, 2);
    assert.ok(streamed.length >= 2);
  });

  it("aborts when signal is aborted", async () => {
    const doc = createMockDoc({
      1: [{ str: "what page 1", transform: [12, 0, 0, 12, 50, 250], width: 60, hasEOL: false }],
      2: [{ str: "what page 2", transform: [12, 0, 0, 12, 50, 250], width: 60, hasEOL: false }],
    });

    const ac = new AbortController();
    ac.abort();

    const results = await searchPdfText(doc, "what", undefined, ac.signal);
    assert.equal(results.length, 0);
  });
});
