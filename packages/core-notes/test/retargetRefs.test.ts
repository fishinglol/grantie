import assert from "node:assert/strict";
import test from "node:test";
import { retargetNoteRefs } from "../src/retargetRefs.ts";

test("a popup card follows a renamed note", () => {
  const text = "intro\n\n```popup\nnote: Projects/plan.md\n```\n\nafter";
  assert.equal(retargetNoteRefs(text, "Projects/plan.md", "Projects/roadmap.md"), "intro\n\n```popup\nnote: Projects/roadmap.md\n```\n\nafter");
});

test("only the card that points at the note changes", () => {
  const text = "```popup\nnote: a.md\n```\n```popup\nnote: b.md\n```\nnote: a.md";
  assert.equal(retargetNoteRefs(text, "a.md", "c.md"), "```popup\nnote: c.md\n```\n```popup\nnote: b.md\n```\nnote: a.md");
});

test("a note cell in a table follows, and its title too when it was the file name", () => {
  const text = "| A | B |\n| --- | --- |\n| [My plan](note:Docs/My%20plan.md) | [Custom](note:Docs/My%20plan.md) |";
  assert.equal(
    retargetNoteRefs(text, "Docs/My plan.md", "Docs/Big plan (v2).md"),
    "| A | B |\n| --- | --- |\n| [Big plan (v2)](note:Docs/Big%20plan%20%28v2%29.md) | [Custom](note:Docs/Big%20plan%20%28v2%29.md) |",
  );
});

test("a moved folder moves the notes inside it", () => {
  const text = "```popup\nnote: Old/a.md\n```\n| [a](note:Old/sub/b.md) | [x](note:Other/c.md) |";
  assert.equal(
    retargetNoteRefs(text, "Old", "New/Old", true),
    "```popup\nnote: New/Old/a.md\n```\n| [a](note:New/Old/sub/b.md) | [x](note:Other/c.md) |",
  );
});

test("web links and unrelated text are left alone", () => {
  const text = "| [a](https://example.com/a.md) |\nnote: a.md\n[a](a.md)";
  assert.equal(retargetNoteRefs(text, "a.md", "b.md"), text);
});
