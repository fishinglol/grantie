import assert from "node:assert/strict";
import test from "node:test";
import { merge3 } from "../src/merge3.ts";

const lines = (...l: string[]) => l.join("\n");

test("changes on different lines are both kept", () => {
  const base = lines("a", "b", "c", "d");
  assert.equal(merge3(base, lines("a", "B", "c", "d"), lines("a", "b", "c", "D")), lines("a", "B", "c", "D"));
});

test("neighbouring lines edited on each side merge too", () => {
  const base = lines("a", "b", "c");
  assert.equal(merge3(base, lines("a", "B", "c"), lines("a", "b", "C")), lines("a", "B", "C"));
});

test("a deletion on one side and an edit elsewhere on the other", () => {
  const base = lines("card1", "card2", "card3", "card4");
  assert.equal(merge3(base, lines("card1", "card3", "card4"), lines("card1", "card2", "card3", "card4 + image")), lines("card1", "card3", "card4 + image"));
});

test("insertions in different places, and at the same place by both, are kept", () => {
  const base = lines("a", "b");
  assert.equal(merge3(base, lines("x", "a", "b"), lines("a", "b", "y")), lines("x", "a", "b", "y"));
  assert.equal(merge3(base, lines("a", "one", "b"), lines("a", "one", "b")), lines("a", "one", "b"));
});

test("the same line changed differently on both sides is a conflict", () => {
  const base = lines("a", "b", "c");
  assert.equal(merge3(base, lines("a", "B1", "c"), lines("a", "B2", "c")), null);
});

test("an edit to a line the other side deleted is a conflict; the same deletion on both is not", () => {
  const base = lines("a", "b", "c");
  assert.equal(merge3(base, lines("a", "c"), lines("a", "b!", "c")), null);
  assert.equal(merge3(base, lines("a", "c"), lines("a", "c")), lines("a", "c"));
});

test("two different insertions at the same place are a conflict", () => {
  const base = lines("a", "b");
  assert.equal(merge3(base, lines("a", "x", "b"), lines("a", "y", "b")), null);
});

test("an untouched side takes the other side as is, including a trailing newline", () => {
  assert.equal(merge3("a\nb\n", "a\nb\n", "a\nB\nc\n"), "a\nB\nc\n");
  assert.equal(merge3("a\nb\n", "A\nb\n", "a\nb\n"), "A\nb\n");
});

test("a very large change is left to the caller instead of being compared", () => {
  const base = Array.from({ length: 4000 }, (_, i) => `l${i}`).join("\n");
  const ours = Array.from({ length: 4000 }, (_, i) => `o${i}`).join("\n");
  const theirs = Array.from({ length: 4000 }, (_, i) => `t${i}`).join("\n");
  assert.equal(merge3(base, ours, theirs), null);
});
