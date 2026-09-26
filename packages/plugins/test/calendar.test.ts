import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The Calendar plugin is one plain JS file; load it the way the sandbox does and test its settings, dates and layout.
const hooks: Record<string, any> = {};
const code = readFileSync(new URL("../../../examples/plugins/calendar/main.js", import.meta.url), "utf8");
vm.runInNewContext(code, { __calendarTest: hooks, console, Intl });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const { parseConfig, serializeConfig, parseDay, monthDays, dateRange, layoutDays, properties, yearMonths } = hooks;

test("an empty block is a month calendar on `date` / `end_date`, and settings round-trip", () => {
  const c = plain(parseConfig(""));
  assert.deepEqual(c, { view: "month", date: "date", end: "end_date", title: "", week: "monday", page: "" });
  const text = serializeConfig({ ...c, view: "linear", date: "start", page: "1" });
  assert.equal(text, "view: linear\ndate: start\nend: end_date\ntitle: \nweek: monday\npage: 1");
  assert.equal(parseConfig(text).view, "linear");
  assert.equal(parseConfig("view: nonsense").view, "month");
});

test("dates: ISO days and datetimes use their written day; impossible days are rejected", () => {
  assert.equal(parseDay("2026-09-21"), "2026-09-21");
  assert.equal(parseDay("2026-09-21T23:30:00+07:00"), "2026-09-21");
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("next tuesday"), null);
});

test("a month grid is whole weeks, starting Monday or Sunday", () => {
  // September 2026 starts on a Tuesday.
  const mon = monthDays(2026, 8, 1);
  const sun = monthDays(2026, 8, 0);
  assert.equal(mon.length % 7, 0);
  assert.equal(mon[0].getDate(), 31); // Monday 31 Aug
  assert.equal(sun[0].getDate(), 30); // Sunday 30 Aug
  assert.equal(yearMonths(2028).flat().length, 366);
});

test("ranges: end is inclusive, a bad end falls back to the start day", () => {
  assert.deepEqual(plain(dateRange("2026-09-21", "2026-09-25")), { start: "2026-09-21", end: "2026-09-25", invalidEnd: false });
  assert.deepEqual(plain(dateRange("2026-09-21", "")), { start: "2026-09-21", end: "2026-09-21", invalidEnd: false });
  assert.deepEqual(plain(dateRange("2026-09-21", "2026-09-01")), { start: "2026-09-21", end: "2026-09-21", invalidEnd: true });
  assert.equal(dateRange("", null), null);
});

test("overlapping notes get separate lanes; a range crossing the week is marked", () => {
  const keys = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  const segs = plain(layoutDays([{ start: "2026-09-18", end: "2026-09-23" }, { start: "2026-09-22", end: "2026-09-22" }, { start: "2026-09-25", end: "2026-10-02" }], keys));
  assert.deepEqual(segs, [
    { index: 0, column: 0, length: 3, lane: 0, continuesBefore: true, continuesAfter: false },
    { index: 1, column: 1, length: 1, lane: 1, continuesBefore: false, continuesAfter: false },
    { index: 2, column: 4, length: 3, lane: 0, continuesBefore: false, continuesAfter: true },
  ]);
});

test("front matter properties are read, quotes removed; no front matter is no properties", () => {
  assert.deepEqual(plain(properties("---\ndate: 2026-09-21\nend_date: '2026-09-25'\ntags:\n  - a\ntitle: \"Trip\"\n---\n# Hi")), {
    date: "2026-09-21",
    end_date: "2026-09-25",
    tags: "",
    title: "Trip",
  });
  assert.deepEqual(plain(properties("# no front matter\ndate: 2026-01-01")), {});
});
