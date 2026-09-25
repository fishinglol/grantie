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

test("dropdown cells are stored on a trailing comment line and read back", () => {
  const dd = { 0: { options: [{ name: "important", color: "red" }, { name: "normal", color: "yellow" }], rows: [1] } };
  const m = { rows: [["Priority", "Note"], ["important", "a"], ["", "b"]], aligns: ["", ""], dd };
  const text = serializeTable(m);
  assert.equal(text.split("\n").pop(), '<!-- dropdowns {"0":{"o":[["important","red"],["normal","yellow"]],"r":[1]}} -->');
  assert.deepEqual(plain(parseTable(text)), m);
});

test("only the listed rows of a column are dropdowns; rows outside the table are dropped", () => {
  const text = '| a |\n| --- |\n| x |\n| y |\n<!-- dropdowns {"0":{"o":[["ok","red"]],"r":[2,9,0,2]}} -->';
  assert.deepEqual(plain(parseTable(text).dd), { 0: { options: [{ name: "ok", color: "red" }], rows: [2] } });
});

test("a 1.2 dropdowns line (options only) means every data row of the column", () => {
  const text = '| a | b |\n| --- | --- |\n| x | 1 |\n| y | 2 |\n<!-- dropdowns {"1":[["ok","red"]]} -->';
  assert.deepEqual(plain(parseTable(text).dd), { 1: { options: [{ name: "ok", color: "red" }], rows: [1, 2] } });
});

test("a table without dropdowns has no dd and no extra line", () => {
  const m = { rows: [["a", "b"], ["1", "2"]], aligns: ["", ""] };
  assert.ok(!serializeTable(m).includes("dropdowns"));
  assert.ok(!("dd" in plain(parseTable(serializeTable(m)))));
});

test("a dropdowns line is made safe: unknown columns, colours and duplicate names are dropped, names cannot end the comment or fence", () => {
  const text = '| a | b |\n| --- | --- |\n| x | y |\n<!-- dropdowns {"1":{"o":[["ok","chartreuse"],["ok","red"],["",""]],"r":[1]},"7":{"o":[["z","red"]],"r":[1]},"x":[]} -->';
  assert.deepEqual(plain(parseTable(text).dd), { 1: { options: [{ name: "ok", color: "gray" }], rows: [1] } });
  const back = serializeTable({ rows: [["a"], ["--> ```"]], aligns: [""], dd: { 0: { options: [{ name: "--> ```", color: "red" }], rows: [1] } } });
  const last = back.split("\n").pop()!;
  assert.ok(!/[<>`]/.test(last.slice("<!-- dropdowns ".length, -" -->".length)));
  assert.equal(plain(parseTable(back).dd)[0].options[0].name, "--> ```");
});

test("a broken dropdowns line is ignored, the table still reads", () => {
  const m = plain(parseTable("| a |\n| --- |\n| 1 |\n<!-- dropdowns {oops -->"));
  assert.deepEqual(m.rows, [["a"], ["1"]]);
});

test("a link cell is a Markdown link and reads back, brackets and parentheses included", () => {
  const { parseLinkCell, linkCell } = hooks;
  const cell = linkCell("Video [1]", "https://example.com/a(b)?x=1 2");
  assert.equal(cell, "[Video \\[1\\]](https://example.com/a%28b%29?x=1%202)");
  assert.deepEqual(plain(parseLinkCell(cell)), { title: "Video [1]", url: "https://example.com/a%28b%29?x=1%202" });
  assert.equal(parseLinkCell("just text"), null);
  assert.equal(parseLinkCell("[x](ftp://example.com)"), null);
});

test("a link cell survives the table text", () => {
  const m = { rows: [["Topic"], [hooks.linkCell("A | B", "https://youtu.be/x")]], aligns: [""] };
  assert.deepEqual(plain(parseTable(serializeTable(m))), m);
});

test("the cell menu's Date and Time entries write plain text", () => {
  const d = new Date(2026, 8, 5, 7, 3);
  assert.equal(hooks.stamp("date", d), "2026-09-05");
  assert.equal(hooks.stamp("time", d), "07:03");
});

test("a popup cell is a Markdown link to a note and reads back", () => {
  const cell = hooks.noteCell("Projects/My plan (v2).md");
  assert.equal(cell, "[My plan (v2)](Projects/My%20plan%20%28v2%29.md)");
  assert.deepEqual(plain(hooks.parseNoteCell(cell)), { title: "My plan (v2)", path: "Projects/My plan (v2).md" });
  assert.equal(hooks.parseNoteCell("[Docs](https://example.com/a.md)"), null);
  assert.equal(hooks.parseNoteCell("plain text"), null);
});
