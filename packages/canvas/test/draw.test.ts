import { test } from "node:test";
import assert from "node:assert/strict";
import {
  strokeBox,
  smoothPath,
  simplify,
  hitsStroke,
  shapePath,
  DRAWER_SHAPES,
  MORE_SHAPES,
  type Point,
} from "../src/draw.ts";

// ——— strokeBox ———

test("strokeBox: basic bounds with stroke width", () => {
  const pts: Point[] = [[10, 20], [30, 40], [50, 10]];
  const { x, y, width, height, relative } = strokeBox(pts, 4);
  assert.ok(x <= 10 - 2);
  assert.ok(y <= 10 - 2);
  assert.ok(width >= 40 + 4);
  assert.ok(height >= 30 + 4);
  // Relative points shifted to local origin
  assert.equal(relative.length, 3);
  assert.ok(relative[0]![0] > 0 && relative[0]![1] > 0);
});

test("strokeBox: single point gives non-zero box", () => {
  const { width, height } = strokeBox([[5, 5]], 6);
  assert.ok(width >= 1);
  assert.ok(height >= 1);
});

test("strokeBox: empty points", () => {
  const r = strokeBox([], 4);
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.deepEqual(r.relative, []);
});

// ——— smoothPath ———

test("smoothPath: empty gives empty string", () => {
  assert.equal(smoothPath([]), "");
});

test("smoothPath: one point gives a tiny M..L segment", () => {
  const d = smoothPath([[5, 10]]);
  assert.ok(d.startsWith("M 5 10"));
});

test("smoothPath: two points gives M..L", () => {
  const d = smoothPath([[0, 0], [10, 10]]);
  assert.ok(d.includes("M 0 0"));
  assert.ok(d.includes("L 10 10"));
});

test("smoothPath: 3+ points uses Q curves", () => {
  const d = smoothPath([[0, 0], [10, 5], [20, 0]]);
  assert.ok(d.includes("Q"));
});

// ——— simplify ———

test("simplify: keeps endpoints", () => {
  const pts: Point[] = [[0, 0], [1, 0], [2, 0], [100, 0]];
  const out = simplify(pts, 1.5);
  assert.equal(out[0], pts[0]);
  assert.equal(out[out.length - 1], pts[pts.length - 1]);
});

test("simplify: removes duplicates that are within tolerance", () => {
  const pts: Point[] = [[0, 0], [0.5, 0], [0.8, 0], [10, 0]];
  const out = simplify(pts, 1.5);
  // Middle points are too close — should be dropped
  assert.ok(out.length < pts.length);
});

test("simplify: two points unchanged", () => {
  const pts: Point[] = [[0, 0], [100, 100]];
  const out = simplify(pts, 1.5);
  assert.equal(out.length, 2);
});

// ——— hitsStroke ———

test("hitsStroke: point on the stroke path", () => {
  const pts: Point[] = [[0, 0], [100, 0]];
  assert.ok(hitsStroke(pts, [50, 0], 5));
});

test("hitsStroke: point near segment perpendicular", () => {
  const pts: Point[] = [[0, 0], [100, 0]];
  assert.ok(hitsStroke(pts, [50, 3], 5)); // 3 px from segment, within 5 px radius
});

test("hitsStroke: point far away", () => {
  const pts: Point[] = [[0, 0], [10, 0]];
  assert.ok(!hitsStroke(pts, [100, 100], 5));
});

test("hitsStroke: single point hit", () => {
  const pts: Point[] = [[50, 50]];
  assert.ok(hitsStroke(pts, [52, 50], 5));
  assert.ok(!hitsStroke(pts, [60, 50], 5));
});

// ——— shape paths ———

test("every drawer shape produces a non-empty path inside its bounding box", () => {
  for (const id of DRAWER_SHAPES) {
    const d = shapePath(id, 160, 160);
    assert.ok(d.length > 0, `${id} path is empty`);
    assert.ok(d.includes("M"), `${id} path has no M command`);
    // No negative coordinates (path should fit the box)
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    for (const n of nums) assert.ok(n >= -1, `${id} path has value ${n} < -1`); // tiny floating point allowed
  }
});

test("every more-shapes shape produces a non-empty path", () => {
  for (const id of MORE_SHAPES) {
    const d = shapePath(id, 120, 120);
    assert.ok(d.length > 0, `${id} path is empty`);
    assert.ok(d.includes("M"), `${id} path has no M command`);
  }
});

test("pill shape is wider-friendly (200x80)", () => {
  const d = shapePath("pill", 200, 80);
  assert.ok(d.includes("Q")); // has rounded corners
  assert.ok(!d.includes("NaN"));
});
