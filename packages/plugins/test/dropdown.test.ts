import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Dropdown plugin is one plain JS file; load it the way the sandbox does and test how a dropdown is stored.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/dropdown/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __dropdownTest: hooks, console });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const { parseDropdown, serializeDropdown, tidy, fence, blank } = hooks;

test("an empty fence is the four default options with none chosen", () => {
  const m = plain(parseDropdown(""));
  assert.deepEqual(m.options.map((o: any) => o.name), ["important", "normal", "not really", "not important"]);
  assert.equal(m.selected, -1);
});

test("a dropdown is stored as text and reads back", () => {
  const m = { options: [{ name: "important", color: "red" }, { name: "normal", color: "yellow" }], selected: 1 };
  const text = serializeDropdown(m);
  assert.equal(text, "value: normal\nimportant | red\nnormal | yellow");
  assert.deepEqual(plain(parseDropdown(text)), m);
});

test("none chosen, an unknown colour and a missing colour", () => {
  const m = plain(parseDropdown("value:\nfoo | chartreuse\nbar"));
  assert.equal(m.selected, -1);
  assert.deepEqual(m.options, [{ name: "foo", color: "gray" }, { name: "bar", color: "gray" }]);
});

test("a chosen option that no longer exists is none", () => {
  assert.equal(plain(parseDropdown("value: gone\na | red")).selected, -1);
});

test("a name cannot break the text: line breaks, | and a fence are neutralised", () => {
  const text = serializeDropdown({ options: [{ name: "a | b\n```\nc", color: "red" }], selected: 0 });
  assert.equal(text.split("\n").length, 2);
  assert.ok(!text.includes("```"));
  assert.deepEqual(plain(parseDropdown(text)).options, [{ name: "a / b ''' c", color: "red" }]);
});

test("with no options the text is still not empty (so it is not reset to the defaults)", () => {
  const text = serializeDropdown({ options: [], selected: -1 });
  assert.equal(text, "value: ");
  assert.deepEqual(plain(parseDropdown(text)).options, []);
});

test("finishing editing drops empty names, makes names unique and keeps the chosen one chosen", () => {
  const m = tidy({ options: [{ name: "a", color: "red" }, { name: " ", color: "blue" }, { name: "A", color: "green" }, { name: "b", color: "gray" }], selected: 2 });
  assert.deepEqual(plain(m).options.map((o: any) => o.name), ["a", "A 2", "b"]);
  assert.equal(m.selected, 1);
});

test("the // entry inserts a fenced dropdown", () => {
  assert.match(fence(blank()), /^```dropdown\nvalue: \nimportant \| red\n[\s\S]*\n```$/);
});
