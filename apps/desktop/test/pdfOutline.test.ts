import test from "node:test";
import assert from "node:assert/strict";
import { resolveDestinationPage, extractPdfOutline } from "../src/pages/pdf/pdfOutline.ts";

test("resolveDestinationPage handles numeric index", async () => {
  const doc = {};
  const page = await resolveDestinationPage(doc, [5, { name: "XYZ" }]);
  assert.equal(page, 6);
});

test("resolveDestinationPage handles object ref via getPageIndex", async () => {
  const doc = {
    getPageIndex: async (ref: any) => (ref.num === 12 ? 9 : -1),
  };
  const page = await resolveDestinationPage(doc, [{ num: 12 }, { name: "Fit" }]);
  assert.equal(page, 10);
});

test("resolveDestinationPage resolves named string destination", async () => {
  const doc = {
    getDestination: async (name: string) => (name === "ch1" ? [14] : null),
  };
  const page = await resolveDestinationPage(doc, "ch1");
  assert.equal(page, 15);
});

test("resolveDestinationPage returns null on invalid destination or errors", async () => {
  const doc = {
    getDestination: async () => {
      throw new Error("fail");
    },
  };
  assert.equal(await resolveDestinationPage(doc, null), null);
  assert.equal(await resolveDestinationPage(doc, "missing"), null);
});

test("extractPdfOutline flattens tree and preserves levels and page numbers", async () => {
  const mockDoc = {
    getOutline: async () => [
      {
        title: "Chapter 1: Intro",
        dest: [0],
        items: [
          {
            title: "Section 1.1",
            dest: [2],
          },
        ],
      },
      {
        title: "Chapter 2: Methods",
        dest: [10],
      },
    ],
  };

  const items = await extractPdfOutline(mockDoc);
  assert.equal(items.length, 3);
  assert.equal(items[0]!.title, "Chapter 1: Intro");
  assert.equal(items[0]!.page, 1);
  assert.equal(items[0]!.level, 0);

  assert.equal(items[1]!.title, "Section 1.1");
  assert.equal(items[1]!.page, 3);
  assert.equal(items[1]!.level, 1);

  assert.equal(items[2]!.title, "Chapter 2: Methods");
  assert.equal(items[2]!.page, 11);
  assert.equal(items[2]!.level, 0);
});

test("extractPdfOutline returns empty array when no outline exists", async () => {
  assert.deepEqual(await extractPdfOutline(null), []);
  assert.deepEqual(await extractPdfOutline({ getOutline: async () => null }), []);
  assert.deepEqual(await extractPdfOutline({ getOutline: async () => [] }), []);
});
