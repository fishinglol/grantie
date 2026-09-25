import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Popup plugin is one plain JS file; load it the way the sandbox does and test how a popup is stored and previewed.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/popup/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __popupTest: hooks, console });
const { parsePopup, serializePopup, fence, previewOf, titleOf, folderOf } = hooks;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test("an empty fence has no note chosen", () => {
  assert.deepEqual(plain(parsePopup("")), { note: "" });
  assert.equal(fence({ note: "" }), "```popup\nnote: \n```");
});

test("a popup is stored as text and reads back", () => {
  const text = serializePopup({ note: "Daily/2026-09-25.md" });
  assert.equal(text, "note: Daily/2026-09-25.md");
  assert.deepEqual(plain(parsePopup(text)), { note: "Daily/2026-09-25.md" });
});

test("a path is kept on one line and cannot close the fence", () => {
  assert.equal(serializePopup({ note: "a`b\nc.md" }), "note: a'b c.md");
});

test("title and folder come from the path", () => {
  assert.equal(titleOf("Daily/2026-09-25.md"), "2026-09-25");
  assert.equal(folderOf("Daily/2026-09-25.md"), "Daily");
  assert.equal(titleOf("plan.md"), "plan");
  assert.equal(folderOf("plan.md"), "");
});

test("the preview skips the front matter and Markdown markers", () => {
  assert.equal(previewOf("---\ndate: 2026-09-25\n---\n\n- post v.1 of colony\n- second\n- third"), "post v.1 of colony · second");
  assert.equal(previewOf("# Title\n\nSome text"), "Title · Some text");
  assert.equal(previewOf(""), "");
});
