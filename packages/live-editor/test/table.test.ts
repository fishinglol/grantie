import assert from "node:assert/strict";
import test from "node:test";
import { parseTable, serializeTable, parseTsv, blankTable } from "../src/table.ts";

test("parseTable parses standard markdown pipe table", () => {
  const md = `| Col 1 | Col 2 |
| :---: | ---: |
| Hello | World |
| Foo | Bar |`;

  const model = parseTable(md);
  assert.equal(model.rows.length, 3);
  assert.deepEqual(model.rows[0], ["Col 1", "Col 2"]);
  assert.deepEqual(model.rows[1], ["Hello", "World"]);
  assert.deepEqual(model.rows[2], ["Foo", "Bar"]);
  assert.deepEqual(model.aligns, ["center", "right"]);
});

test("parseTable preserves escaped pipes", () => {
  const md = `| Col 1 | Col 2 |
| --- | --- |
| Escaped \\| pipe | Normal |`;

  const model = parseTable(md);
  assert.equal(model.rows[1]?.[0], "Escaped | pipe");
  const serialized = serializeTable(model);
  assert.ok(serialized.includes("Escaped \\| pipe"));
});

test("parseTable and serializeTable roundtrip with dropdowns", () => {
  const md = `| Priority | Topic |
| --- | --- |
| important | Granite |
<!-- dropdowns {"0":{"o":[["important","red"],["normal","yellow"]],"r":[1]}} -->`;

  const model = parseTable(md);
  assert.ok(model.dd);
  assert.equal(model.dd[0]?.options.length, 2);
  assert.equal(model.dd[0]?.options[0]?.name, "important");
  assert.equal(model.dd[0]?.options[0]?.color, "red");

  const serialized = serializeTable(model);
  assert.ok(serialized.includes("<!-- dropdowns"));
  const roundtrip = parseTable(serialized);
  assert.deepEqual(roundtrip.dd, model.dd);
});

test("parseTsv parses spreadsheet clipboard data", () => {
  const tsv = 'A\tB\n"Line 1\nLine 2"\tD';
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["A", "B"]);
  assert.deepEqual(rows[1], ["Line 1 Line 2", "D"]);
});

test("blankTable generates correctly sized table", () => {
  const t = blankTable(3, 4);
  assert.equal(t.rows.length, 4);
  assert.equal(t.rows[0]?.length, 3);
});
