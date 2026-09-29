import assert from "node:assert/strict";
import { test } from "node:test";
import { noteTitle, renamedNoteFile, windowsSafe } from "../src/noteName.ts";

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

test("windowsSafe: names Windows can't create get changed, everything else is left alone", () => {
  assert.equal(windowsSafe("CON"), "_CON");
  assert.equal(windowsSafe("nul.md"), "_nul.md"); // reserved with or without an extension
  assert.equal(windowsSafe("COM1.canvas"), "_COM1.canvas");
  assert.equal(windowsSafe("lpt9"), "_lpt9");
  assert.equal(windowsSafe("Notes."), "Notes"); // Windows drops a trailing dot or space, so the file would not be the one asked for
  assert.equal(windowsSafe("Notes  "), "Notes");
  assert.equal(windowsSafe("Console"), "Console");
  assert.equal(windowsSafe("com10"), "com10");
  assert.equal(windowsSafe("Weekly plan.md"), "Weekly plan.md");
});

test("renaming a note to a reserved Windows name gives a name that works", () => {
  assert.equal(renamedNoteFile("old.md", "CON"), "_CON.md");
  assert.equal(renamedNoteFile("old.md", "Plan."), "Plan.md");
});
