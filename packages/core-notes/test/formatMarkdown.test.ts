import assert from "node:assert/strict";
import { test } from "node:test";
import { toggleFormat, type FormatEdit, type InlineFormat } from "../src/formatMarkdown.ts";

/** Apply an edit the way an editor would, returning the new text and the selected text. */
function run(text: string, from: number, to: number, format: InlineFormat) {
  const edit: FormatEdit = toggleFormat(text, from, to, format);
  let out = "";
  let at = 0;
  for (const c of edit.changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  out += text.slice(at);
  const { anchor, head } = edit.selection;
  return { out, selected: out.slice(Math.min(anchor, head), Math.max(anchor, head)), cursor: head };
}

test("wraps a selection and keeps it selected", () => {
  const r = run("say hello there", 4, 9, "bold");
  assert.equal(r.out, "say **hello** there");
  assert.equal(r.selected, "hello");
});

test("toggling again takes the markers off", () => {
  const r = run("say **hello** there", 6, 11, "bold");
  assert.equal(r.out, "say hello there");
  assert.equal(r.selected, "hello");
});

test("spaces at the edge of the selection stay outside the markers", () => {
  assert.equal(run("a  word  b", 1, 9, "italic").out, "a  *word*  b");
});

test("bold is not mistaken for italic, and both can be combined and removed one at a time", () => {
  const both = run("**x**", 2, 3, "italic");
  assert.equal(both.out, "***x***");
  assert.equal(run("***x***", 3, 4, "italic").out, "**x**");
  assert.equal(run("***x***", 3, 4, "bold").out, "*x*");
});

test("strikethrough uses ~~", () => {
  assert.equal(run("old", 0, 3, "strike").out, "~~old~~");
});

test("no selection: formats the word at the cursor and keeps the cursor in place", () => {
  const r = run("one two three", 6, 6, "bold"); // between "tw" and "o"
  assert.equal(r.out, "one **two** three");
  assert.equal(r.cursor, 8);
  const back = run(r.out, r.cursor, r.cursor, "bold");
  assert.equal(back.out, "one two three");
  assert.equal(back.cursor, 6);
});

test("no selection and no word: inserts an empty pair with the cursor between, and a second press removes it", () => {
  const r = run("a  b", 2, 2, "italic");
  assert.equal(r.out, "a ** b");
  assert.equal(r.cursor, 3);
  const back = run(r.out, r.cursor, r.cursor, "italic");
  assert.equal(back.out, "a  b");
  assert.equal(back.cursor, 2);
});

test("words in other scripts count as words", () => {
  assert.equal(run("สวัสดี ครับ", 3, 3, "bold").out, "**สวัสดี** ครับ");
});

test("formats stack on the outside and come off one at a time, in any order", () => {
  const steps: [InlineFormat, string][] = [
    ["bold", "**at**"],
    ["italic", "***at***"],
    ["strike", "~~***at***~~"],
  ];
  let text = "at";
  let [from, to] = [0, 2];
  for (const [format, expected] of steps) {
    const r = run(text, from, to, format);
    assert.equal(r.out, expected);
    text = r.out;
    from = text.indexOf("at");
    to = from + 2;
  }
  assert.equal(run(text, from, to, "bold").out, "~~*at*~~");
  assert.equal(run(text, from, to, "strike").out, "***at***");
  assert.equal(run(text, from, to, "italic").out, "~~**at**~~");
});

test("underline uses <u> tags and toggles off again", () => {
  const on = run("say hello there", 4, 9, "underline");
  assert.equal(on.out, "say <u>hello</u> there");
  assert.equal(on.selected, "hello");
  const off = run(on.out, 7, 12, "underline");
  assert.equal(off.out, "say hello there");
  assert.equal(off.selected, "hello");
});

test("underline stacks with the other formats in any order", () => {
  let r = run("at", 0, 2, "bold");
  r = run(r.out, r.out.indexOf("at"), r.out.indexOf("at") + 2, "underline");
  assert.equal(r.out, "<u>**at**</u>");
  const s = r.out.indexOf("at");
  assert.equal(run(r.out, s, s + 2, "bold").out, "<u>at</u>");
  assert.equal(run(r.out, s, s + 2, "underline").out, "**at**");
  assert.equal(run("<u>x</u>", 3, 4, "italic").out, "*<u>x</u>*");
});

test("underline with no selection formats the word, and keeps the cursor", () => {
  const r = run("one two", 5, 5, "underline"); // inside "two"
  assert.equal(r.out, "one <u>two</u>");
  assert.equal(r.cursor, 8);
  assert.equal(run(r.out, r.cursor, r.cursor, "underline").out, "one two");
});
