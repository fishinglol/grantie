import assert from "node:assert/strict";
import test from "node:test";
import { buildPdfLink, parsePdfLink, pdfBacklinks } from "../src/pdfLink.ts";
import { renamedNoteFile } from "../src/noteName.ts";

const sel = { beginIndex: 2, beginOffset: 0, endIndex: 3, endOffset: 14 };

test("a link to a selection is relative to the note and encoded", () => {
  assert.equal(
    buildPdfLink({ pdf: "Papers/My paper (v2).pdf", fromDir: "Notes", page: 3, selection: sel, label: "My paper (v2).pdf, p.3" }),
    "[My paper (v2).pdf, p.3](../Papers/My%20paper%20%28v2%29.pdf#page=3&selection=2,0,3,14)",
  );
});

test("a link without a selection is just the page, and the label's brackets are escaped", () => {
  assert.equal(buildPdfLink({ pdf: "a.pdf", fromDir: "", page: 1, label: "[x]" }), "[\\[x\\]](a.pdf#page=1)");
});

test("parsing gives back what building wrote", () => {
  const link = buildPdfLink({ pdf: "Papers/My paper (v2).pdf", fromDir: "Notes/Deep", page: 12, selection: sel, label: "l" });
  const url = /\(([^)]+)\)$/.exec(link)![1]!;
  assert.deepEqual(parsePdfLink(url, "Notes/Deep"), { path: "Papers/My paper (v2).pdf", page: 12, selection: sel });
});

test("parsing refuses what is not a vault PDF", () => {
  assert.equal(parsePdfLink("https://x.org/a.pdf#page=2", ""), null);
  assert.equal(parsePdfLink("note.md#page=2", ""), null);
  assert.equal(parsePdfLink("../../a.pdf", "Notes"), null); // leaves the vault
  assert.equal(parsePdfLink("/etc/a.pdf", ""), null);
});

test("a bad page or selection is dropped, the file still opens", () => {
  assert.deepEqual(parsePdfLink("a.pdf#page=0&selection=1,2", ""), { path: "a.pdf" });
  assert.deepEqual(parsePdfLink("a.pdf#page=4&selection=1,2,x,4", ""), { path: "a.pdf", page: 4 });
  assert.deepEqual(parsePdfLink("a.pdf", ""), { path: "a.pdf" });
});

test("backlinks: only links to that PDF, with where they point", () => {
  const text = [
    "intro [one](../Papers/p.pdf#page=2&selection=0,1,0,5) and [two](other.pdf#page=1&selection=0,0,0,2)",
    "[three](../Papers/p.pdf#page=9) ![img](../Papers/p.png) [web](https://x.org/p.pdf#page=1)",
  ].join("\n");
  assert.deepEqual(pdfBacklinks(text, "Notes", "Papers/p.pdf"), [
    { page: 2, selection: { beginIndex: 0, beginOffset: 1, endIndex: 0, endOffset: 5 }, label: "one" },
    { page: 9, label: "three" },
  ]);
});

test("renaming a PDF keeps it a PDF", () => {
  assert.equal(renamedNoteFile("Paper.pdf", "Paper two"), "Paper two.pdf");
  assert.equal(renamedNoteFile("Paper.pdf", "Paper two.pdf"), "Paper two.pdf");
  assert.equal(renamedNoteFile("Paper.pdf", "Paper.pdf"), null);
});
