import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Excel plugin is one plain JS file; load it the way the sandbox does and test its formula engine.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/excel/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __excelTest: hooks, console });
/** Values built inside the vm have another realm's prototypes; compare them as plain data. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const { hiddenRows, cfTest, adjustRect, expandForMerges, mergeAt, makeEvaluator, parseSheet, serializeSheet, shiftFormula, adjustForLines, display, inferFormat, XErr } = hooks;

/** Build a sheet from { A1: "5", B1: "=A1*2" } and return a `get("B1")` that shows the displayed result. */
function sheet(cells: Record<string, string>) {
  const model = parseSheet("");
  for (const [k, v] of Object.entries(cells)) model.cells[k] = { v };
  const ev = makeEvaluator(model);
  return (key: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(key)!;
    const c = hooks.colIndex(m[1]);
    const r = Number(m[2]) - 1;
    return display(ev.cell(c, r), model.cells[key]);
  };
}

test("arithmetic, precedence and references", () => {
  const g = sheet({ A1: "5", A2: "10", B1: "=A1+A2*2", B2: "=(A1+A2)*2", B3: "=-2^2", B4: "=2^3^2", B5: "=A1/A2", B6: "=50%", B7: '="a"&"b"&A1' });
  assert.equal(g("B1"), "25");
  assert.equal(g("B2"), "30");
  assert.equal(g("B3"), "4"); // Excel: unary minus binds tighter than ^
  assert.equal(g("B4"), "64");
  assert.equal(g("B5"), "0.5");
  assert.equal(g("B6"), "0.5");
  assert.equal(g("B7"), "ab5");
});

test("aggregates over ranges ignore text and blanks", () => {
  const g = sheet({ A1: "1", A2: "2", A3: "x", A5: "4", B1: "=SUM(A1:A5)", B2: "=AVERAGE(A1:A5)", B3: "=COUNT(A1:A5)", B4: "=COUNTA(A1:A5)", B5: "=MAX(A1:A5)", B6: "=MIN(A1:A5)", B7: "=SUM(A:A)" });
  assert.deepEqual(["B1", "B2", "B3", "B4", "B5", "B6", "B7"].map(g), ["7", "2.33333333333", "3", "4", "4", "1", "7"]);
});

test("errors", () => {
  const g = sheet({ A1: "0", B1: "=1/A1", B2: "=NOPE(1)", B3: "=A1+\"x\"", B4: "=B4+1", B5: "=IFERROR(1/A1,\"n/a\")", B6: "=SUM(B1)", B7: "=1+" });
  assert.equal(g("B1"), "#DIV/0!");
  assert.equal(g("B2"), "#NAME?");
  assert.equal(g("B3"), "#VALUE!");
  assert.equal(g("B4"), "#CIRCULAR!");
  assert.equal(g("B5"), "n/a");
  assert.equal(g("B6"), "#DIV/0!");
  assert.equal(g("B7"), "#ERROR!");
});

test("logic, text and conditional functions", () => {
  const g = sheet({
    A1: "3", A2: "8", A3: "5", B1: "apple", B2: "Banana", B3: "apple",
    C1: '=IF(A1>2,"big","small")', C2: "=AND(A1>1,A2>1)", C3: '=COUNTIF(B1:B3,"apple")', C4: '=SUMIF(A1:A3,">4")', C5: '=UPPER(LEFT(B2,3))&LEN(B1)',
    C6: '=COUNTIF(B1:B3,"a*")', C7: '=IFS(A1>5,"x",A1>1,"y")', C8: '=TEXTJOIN("-",TRUE,B1:B3)', C9: '=SUMIFS(A1:A3,B1:B3,"apple")',
  });
  assert.deepEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"].map(g), ["big", "TRUE", "2", "13", "BAN5", "2", "y", "apple-Banana-apple", "8"]);
});

test("lookups", () => {
  const g = sheet({ A1: "a", B1: "1", A2: "b", B2: "2", A3: "c", B3: "3", D1: '=VLOOKUP("b",A1:B3,2,FALSE)', D2: '=MATCH("c",A1:A3,0)', D3: "=INDEX(B1:B3,2)", D4: '=VLOOKUP("z",A1:B3,2,FALSE)', D5: '=XLOOKUP("c",A1:A3,B1:B3)', D6: "=CHOOSE(2,10,20,30)" });
  assert.deepEqual(["D1", "D2", "D3", "D4", "D5", "D6"].map(g), ["2", "3", "2", "#N/A", "3", "20"]);
});

test("dates and formats", () => {
  const g = sheet({ A1: "2026-09-21", A2: "=A1+10", B1: "=DATE(2026,1,31)", B2: "=DAY(A1)", B3: '=TEXT(A1,"dd/mm/yyyy")', B4: '=TEXT(1234.5,"#,##0.00")', B5: "=WEEKDAY(A1)", B6: '=DATEDIF(A1,A2,"D")' });
  assert.equal(g("B1"), "2026-01-31"); // date functions display as dates
  assert.deepEqual(["B2", "B3", "B4", "B5", "B6"].map(g), ["21", "21/09/2026", "1,234.50", "2", "10"]);
  assert.deepEqual(plain(inferFormat("50%")), { nf: "pct", dp: 0 });
  assert.deepEqual(plain(inferFormat("2026-09-21")), { nf: "date" });
  assert.equal(inferFormat("hello"), null);
  assert.equal(display(0.256, { nf: "pct", dp: 1 }), "25.6%");
  assert.equal(display(1234.5, { nf: "cur" }), "$1,234.50");
  assert.equal(display(-3, { nf: "cur" }), "-$3.00");
});

test("copying a formula moves relative references, not $ ones", () => {
  assert.equal(shiftFormula("=A1+$B$2+$C3+D$4", 1, 1), "=B2+$B$2+$C4+E$4");
  assert.equal(shiftFormula("=SUM(A1:B2)", 2, 0), "=SUM(A3:B4)");
  assert.equal(shiftFormula("=SUM(A:A)", 3, 1), "=SUM(B:B)");
  assert.equal(shiftFormula("=A1", -1, 0), "=#REF!");
  assert.equal(shiftFormula("=LOG10(A1)", 1, 0), "=LOG10(A2)");
  assert.equal(shiftFormula('="A1"&A1', 0, 1), '="A1"&B1');
});

test("inserting and deleting rows / columns rewrites formulas", () => {
  assert.equal(adjustForLines("=A1+A5", "r", 2, 1), "=A1+A6"); // row inserted above row 3
  assert.equal(adjustForLines("=SUM(A1:A5)", "r", 2, 1), "=SUM(A1:A6)"); // a range that spans the insertion grows
  assert.equal(adjustForLines("=A5", "r", 1, -2), "=A3"); // rows 2-3 deleted
  assert.equal(adjustForLines("=A2", "r", 1, -2), "=#REF!");
  assert.equal(adjustForLines("=SUM(A1:A5)", "r", 1, -2), "=SUM(A1:A3)");
  assert.equal(adjustForLines("=B1+C1", "c", 1, 1), "=C1+D1"); // a column inserted at B pushes B and C right
  assert.equal(adjustForLines("=B1+C1", "c", 2, 1), "=B1+D1");
});

test("a sheet round-trips through its note text, one cell per line", () => {
  const m = parseSheet("");
  m.cells.A1 = { v: "Task", b: 1 };
  m.cells.B2 = { v: "=A1", bg: "#ffff00" };
  m.w.B = 140;
  const text = serializeSheet(m);
  assert.equal(text.split("\n").filter((l: string) => l.startsWith('"A1"') || l.startsWith('"B2"')).length, 2);
  assert.deepEqual(plain(parseSheet(text).cells), plain(m.cells));
  assert.equal(parseSheet(text).w.B, 140);
  assert.equal(parseSheet("").cols, 8);
  assert.throws(() => parseSheet("{nope"));
  assert.ok(new XErr("#N/A") instanceof XErr);
});

test("a whole-page sheet keeps its page flag", () => {
  const m = parseSheet("");
  assert.equal(m.page, 0);
  m.page = 1;
  const text = serializeSheet(m);
  assert.match(text.split("\n")[0], /"page":1/);
  assert.equal(parseSheet(text).page, 1);
  assert.equal(parseSheet(serializeSheet(parseSheet(""))).page, 0);
});

test("conditional-formatting rules", () => {
  const t = (rule: object, v: unknown, shown = String(v ?? "")) => cfTest(rule, v, shown, undefined);
  assert.equal(t({ k: "gt", v: "5" }, 7), true);
  assert.equal(t({ k: "gt", v: "5" }, "7x"), false);
  assert.equal(t({ k: "between", v: "1", v2: "3" }, 2), true);
  assert.equal(t({ k: "between", v: "3", v2: "1" }, 4), false);
  assert.equal(t({ k: "contains", v: "not" }, "Not Started"), true);
  assert.equal(t({ k: "is", v: "done" }, "Done"), true);
  assert.equal(t({ k: "empty" }, null, ""), true);
  assert.equal(t({ k: "notEmpty" }, 0, "0"), true);
  assert.equal(t({ k: "eq", v: "Paid" }, "paid"), true);
  assert.equal(cfTest({ k: "formula" }, 1, "1", true), true);
  assert.equal(cfTest({ k: "formula" }, 1, "1", "yes"), false);
});

test("merged cells and rectangles follow inserted and deleted lines", () => {
  const merges = [{ r1: 1, c1: 1, r2: 2, c2: 3 }];
  assert.deepEqual(plain(expandForMerges({ r1: 2, c1: 3, r2: 2, c2: 3 }, merges)), { r1: 1, r2: 2, c1: 1, c2: 3 });
  assert.deepEqual(plain(expandForMerges({ r1: 5, c1: 5, r2: 5, c2: 5 }, merges)), { r1: 5, r2: 5, c1: 5, c2: 5 });
  assert.equal(mergeAt(merges, 2, 2) !== null, true);
  assert.equal(mergeAt(merges, 0, 0), null);
  assert.deepEqual(plain(adjustRect({ r1: 1, c1: 0, r2: 3, c2: 2 }, "r", 2, 1)), { r1: 1, c1: 0, r2: 4, c2: 2 }); // inserted inside: grows
  assert.deepEqual(plain(adjustRect({ r1: 4, c1: 0, r2: 5, c2: 2 }, "r", 0, 2)), { r1: 6, c1: 0, r2: 7, c2: 2 }); // inserted above: moves
  assert.deepEqual(plain(adjustRect({ r1: 1, c1: 0, r2: 3, c2: 2 }, "r", 1, -2)), { r1: 1, c1: 0, r2: 1, c2: 2 }); // partly deleted: shrinks
  assert.equal(adjustRect({ r1: 1, c1: 0, r2: 2, c2: 2 }, "r", 1, -2), null); // all deleted: gone
  assert.deepEqual(plain(adjustRect({ r1: 0, c1: 2, r2: 4, c2: 4 }, "c", 0, -1)), { r1: 0, c1: 1, r2: 4, c2: 3 });
});

test("merges, rules and alternating colours are saved with the sheet", () => {
  const m = parseSheet("");
  m.merges = [{ r1: 0, c1: 0, r2: 0, c2: 3 }];
  m.cf = [{ r1: 0, c1: 1, r2: 9, c2: 1, k: "gt", v: "5", bg: "#f4cccc" }];
  m.alt = [{ r1: 0, c1: 0, r2: 9, c2: 3, h: "#4a86e8", a: "#ffffff", b: "#e8f0fe" }];
  const back = parseSheet(serializeSheet(m));
  assert.deepEqual(plain(back.merges), plain(m.merges));
  assert.deepEqual(plain(back.cf), plain(m.cf));
  assert.deepEqual(plain(back.alt), plain(m.alt));
  assert.deepEqual(plain(parseSheet('{"merges":[{"r1":"x"},null,{"r1":0,"c1":0,"r2":1,"c2":1}]}').merges).length, 1); // junk entries are dropped
  assert.equal(serializeSheet(parseSheet("")).includes("merges"), false);
});

test("a formula outside any cell can be evaluated (conditional formatting)", () => {
  const model = parseSheet("");
  model.cells.B2 = { v: "9" };
  const ev = makeEvaluator(model);
  assert.equal(ev.formula("=B2>5"), true);
  assert.equal(ev.formula("=B2>50"), false);
  assert.equal(ev.formula("=1/0"), null);
});

test("a table filter hides the rows whose value is not allowed", () => {
  const m = parseSheet("");
  m.cells = { A1: { v: "Task" }, B1: { v: "Status" }, A2: { v: "a" }, B2: { v: "Done" }, A3: { v: "b" }, B3: { v: "Open" }, A4: { v: "c" }, B4: { v: "Done" } };
  m.tables = [{ r1: 0, c1: 0, r2: 3, c2: 1 }];
  assert.equal(hiddenRows(m, makeEvaluator(m)).size, 0);
  m.tables[0].f = { 1: ["Done"] };
  assert.deepEqual([...hiddenRows(m, makeEvaluator(m))], [2]); // row 3 ("Open"); the header is never hidden
  m.tables[0].f = { 0: ["a", "c"], 1: ["Done"] };
  assert.deepEqual([...hiddenRows(m, makeEvaluator(m))], [2]);
  const back = parseSheet(serializeSheet(m));
  assert.deepEqual(plain(back.tables), plain(m.tables));
});

test("theme and font are saved and unknown ones ignored", () => {
  const m = parseSheet("");
  m.th = "dark";
  m.ff = "serif";
  const back = parseSheet(serializeSheet(m));
  assert.equal(back.th, "dark");
  assert.equal(back.ff, "serif");
  assert.equal(parseSheet('{"th":"neon","ff":"comic"}').th, "");
  assert.equal(serializeSheet(parseSheet("")).includes('"th"'), false);
});
