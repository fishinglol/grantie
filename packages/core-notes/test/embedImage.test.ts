import assert from "node:assert/strict";
import { test } from "node:test";
import { embedImage } from "../src/embedImage.ts";
import { parseNote } from "../src/parseNote.ts";

const fixedNow = () => new Date(2026, 7, 31, 14, 25, 30); // 2026-08-31 14:25:30 local

test("builds a slugged, timestamped path in assets/ and appends the ref", () => {
  const res = embedImage({
    content: "# Note\n\nfirst para",
    image: { fileName: "Screenshot 2026-08-31 at 2.10 PM.png" },
    now: fixedNow,
  });
  assert.equal(res.relativeSrc, "assets/20260831-142530-screenshot-2026-08-31-at-2-10-pm.png");
  assert.equal(res.markdown, `![screenshot-2026-08-31-at-2-10-pm](${res.relativeSrc})`);
  assert.equal(res.content, "# Note\n\nfirst para\n\n" + res.markdown + "\n");
  assert.equal(res.write, null); // no bytes supplied
});

test("returns a write when image data is supplied", () => {
  const data = new Uint8Array([1, 2, 3]);
  const res = embedImage({ content: "x", image: { fileName: "a.JPG", data }, now: fixedNow });
  assert.deepEqual(res.write, { path: "assets/20260831-142530-a.jpg", data });
});

test("honours custom alt text and assets dir", () => {
  const res = embedImage({
    content: "x",
    image: { fileName: "diagram.png" },
    altText: "System diagram",
    assetsDirName: "attachments",
    now: fixedNow,
  });
  assert.equal(res.markdown, "![System diagram](attachments/20260831-142530-diagram.png)");
});

test("inserts at a cursor offset with sane spacing", () => {
  const content = "para one\n\npara two";
  const res = embedImage({
    content,
    image: { fileName: "p.png" },
    insertAt: "para one".length,
    now: fixedNow,
  });
  assert.equal(res.content, "para one\n\n" + res.markdown + "\n\n\npara two");
  // the inserted markdown is parseable as an image
  assert.equal(parseNote(res.content).images.length, 1);
});

test("falls back to 'image' slug and .png extension for odd names", () => {
  const res = embedImage({ content: "x", image: { fileName: "???" }, now: fixedNow });
  assert.equal(res.relativeSrc, "assets/20260831-142530-image.png");
});
