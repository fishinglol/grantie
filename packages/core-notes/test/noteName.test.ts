import assert from "node:assert/strict";
import { test } from "node:test";
import { noteTitle, renamedNoteFile } from "../src/noteName.ts";

test("noteTitle hides the extension", () => {
  assert.equal(noteTitle("Community.md"), "Community");
  assert.equal(noteTitle("a.b.markdown"), "a.b");
  assert.equal(noteTitle("readme"), "readme");
  assert.equal(noteTitle("Board.canvas"), "Board");
});

test("renaming keeps the extension and cleans the name", () => {
  assert.equal(renamedNoteFile("Old.md", "New name"), "New name.md");
  assert.equal(renamedNoteFile("Old.markdown", "New"), "New.markdown");
  assert.equal(renamedNoteFile("Map.canvas", "Plan"), "Plan.canvas");
  assert.equal(renamedNoteFile("Old.md", "  a/b: c?  "), "a-b- c-.md");
  assert.equal(renamedNoteFile("Old.md", "typed.md"), "typed.md");
  assert.equal(renamedNoteFile("Old.md", ".hidden"), "hidden.md");
});

test("nothing to rename to gives null", () => {
  assert.equal(renamedNoteFile("Old.md", "Old"), null);
  assert.equal(renamedNoteFile("Old.md", "   "), null);
  assert.equal(renamedNoteFile("Old.md", "..."), null);
});
