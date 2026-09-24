import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Simple Table plugin is one plain JS file; load it the way the sandbox does and test how a table is stored and pasted.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/simple-table/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __tableTest: hooks, console });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const { parseTable, serializeTable, parseTsv, tableFromTsv, blankTable, fence } = hooks;

test("an empty fence is a blank 3×3 table", () => {
  const m = plain(parseTable(""));
  assert.equal(m.rows.length, 3);
  assert.equal(m.rows[0].length, 3);
});

test("a table is stored as a Markdown pipe table and reads back", () => {
  const m = { rows: [["Day", "Note"], ["1", "a | b"], ["2", ""]], aligns: ["", "center"] };
  const text = serializeTable(m);
  assert.equal(text, "| Day | Note |\n| --- | :---: |\n| 1 | a \\| b |\n| 2 |  |");
  assert.deepEqual(plain(parseTable(text)), m);
});

test("ordinary Markdown tables (no outer pipes, ragged rows) are read too", () => {
  const m = plain(parseTable("a | b | c\n--|:-:|--:\n1 | 2\n"));
  assert.deepEqual(m.rows, [["a", "b", "c"], ["1", "2", ""]]);
  assert.deepEqual(m.aligns, ["", "center", "right"]);
});

test("text with no table in it throws instead of becoming an empty table", () => {
  assert.throws(() => parseTable("just some words"), /no rows/);
});

test("a cell can't break the fence or the row", () => {
  const text = serializeTable({ rows: [["h"], ["x\ny ``` z"]], aligns: [""] });
  assert.ok(!text.includes("```"));
  assert.equal(text.split("\n").length, 3);
});

test("cells copied from Excel become a table, first row as the header", () => {
  const m = plain(tableFromTsv("Day\tDate\n1\t2026-09-21\n2\t2026-09-22\n"));
  assert.deepEqual(m.rows, [["Day", "Date"], ["1", "2026-09-21"], ["2", "2026-09-22"]]);
});

test("quoted cells with line breaks and tabs survive; short rows are padded", () => {
  assert.deepEqual(plain(parseTsv('a\t"line1\nline2"\r\n"x ""q"" y"\tz')), [["a", "line1 line2"], ['x "q" y', "z"]]);
  assert.deepEqual(plain(tableFromTsv("a\tb\tc\n1\n")).rows, [["a", "b", "c"], ["1", "", ""]]);
});

test("a single value or plain text is not turned into a table", () => {
  assert.equal(tableFromTsv("hello"), null);
  assert.equal(tableFromTsv("hello\nworld"), null);
});

test("the inserted fence is the language plus the table", () => {
  assert.match(fence(blankTable(2, 2)), /^```simple-table\n\| {2}\| {2}\|\n\| --- \| --- \|\n\| {2}\| {2}\|\n```$/);
});
