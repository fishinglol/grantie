import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyChange } from "../src/caret.ts";

test("a typed character is a `type`, with what was typed", () => {
  assert.deepEqual(classifyChange("input.type", "a", ""), { type: "type", text: "a" });
  assert.deepEqual(classifyChange("input.type.compose", "こん", ""), { type: "type", text: "こん" });
});

test("Enter is an `enter` (CodeMirror reports it as plain `input` with a line break)", () => {
  assert.deepEqual(classifyChange("input", "\n  ", ""), { type: "enter", text: "" });
});

test("Backspace and Delete are a `delete` with the text that went", () => {
  assert.deepEqual(classifyChange("delete.backward", "", "x"), { type: "delete", text: "x" });
  assert.deepEqual(classifyChange("delete.cut", "", "some words"), { type: "delete", text: "some words" });
  assert.equal(classifyChange("delete.backward", "", ""), null);
});

test("pastes, drops, and edits from the app or a plugin (no user event) are not reported", () => {
  assert.equal(classifyChange("input.paste", "pasted", ""), null);
  assert.equal(classifyChange("input.drop", "dropped", ""), null);
  assert.equal(classifyChange("input.plugin", "from a plugin", ""), null);
  assert.equal(classifyChange(undefined, "sync", ""), null);
  assert.equal(classifyChange("input", "no line break", ""), null);
});

test("a long composed word is cut, so an event stays small", () => {
  const long = "x".repeat(500);
  assert.equal(classifyChange("input.type", long, "")!.text.length, 32);
});
