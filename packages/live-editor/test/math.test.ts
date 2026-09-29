import assert from "node:assert/strict";
import { test } from "node:test";
import { findMath } from "../src/math.ts";

const spans = (text: string) => findMath(text).map((m) => [text.slice(m.from, m.to), m.tex, m.display]);

test("the user's line: display math, then inline math, with Thai around it", () => {
  const text = "$$x_1 = 5 + 4(1) - 7(0) = 9$$, $x_2 = 2$ และ $x_3 = 1$";
  assert.deepEqual(spans(text), [
    ["$$x_1 = 5 + 4(1) - 7(0) = 9$$", "x_1 = 5 + 4(1) - 7(0) = 9", true],
    ["$x_2 = 2$", "x_2 = 2", false],
    ["$x_3 = 1$", "x_3 = 1", false],
  ]);
});

test("display math may span lines; inline math may not", () => {
  assert.deepEqual(spans("$$\n\\begin{bmatrix}1 & 2\\\\3 & 4\\end{bmatrix}\n$$"), [
    ["$$\n\\begin{bmatrix}1 & 2\\\\3 & 4\\end{bmatrix}\n$$", "\\begin{bmatrix}1 & 2\\\\3 & 4\\end{bmatrix}", true],
  ]);
  assert.deepEqual(spans("$a\nb$"), []);
});

test("prices and stray dollars stay text", () => {
  assert.deepEqual(spans("It costs $5 and $10 today"), []);
  assert.deepEqual(spans("between $ 5 and 6 $ here"), []);
  assert.deepEqual(spans("a lone $ sign"), []);
  assert.deepEqual(spans("$x$5"), []);
  assert.deepEqual(spans("$$ $$ empty"), []);
});

test("an escaped dollar is a dollar, also inside math", () => {
  assert.deepEqual(spans("\\$5 then $a$"), [["$a$", "a", false]]);
  assert.deepEqual(spans("$\\$x$"), [["$\\$x$", "\\$x", false]]);
});
