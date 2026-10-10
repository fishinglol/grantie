import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, cssColor, groupsFirst, newId, nodesInGroup, parseCanvas, serializeCanvas, type CanvasData } from "../src/jsonCanvas.ts";

const obsidian = `{
	"nodes":[
		{"id":"a1","type":"text","text":"# Hi","x":0,"y":0,"width":250,"height":60,"color":"1"},
		{"id":"g1","type":"group","label":"Box","x":-20,"y":-20,"width":600,"height":300},
		{"id":"f1","type":"file","file":"notes/plan.md","x":300,"y":0,"width":250,"height":200,"styleAttributes":{}}
	],
	"edges":[
		{"id":"e1","fromNode":"a1","fromSide":"right","toNode":"f1","toSide":"left","label":"next"},
		{"id":"e2","fromNode":"a1","toNode":"gone"}
	],
	"metadata":{"version":"1.0-1.0"}
}`;

test("reads an Obsidian canvas and keeps fields it doesn't know", () => {
  const c = parseCanvas(obsidian);
  assert.equal(c.nodes.length, 3);
  assert.deepEqual((c.nodes[2] as unknown as { styleAttributes: object }).styleAttributes, {});
  assert.deepEqual((c as unknown as { metadata: object }).metadata, { version: "1.0-1.0" });
});

test("drops edges to missing nodes and unknown node types", () => {
  const c = parseCanvas(`{"nodes":[{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1},{"id":"b","type":"weird"}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}`);
  assert.deepEqual(c.nodes.map((n) => n.id), ["a"]);
  assert.equal(c.edges.length, 0);
});

test("an empty file is an empty canvas; other JSON is refused", () => {
  assert.deepEqual(parseCanvas("  \n"), { nodes: [], edges: [] });
  assert.throws(() => parseCanvas("[1,2]"));
  assert.throws(() => parseCanvas("{oops"));
});

test("writes tab-indented JSON that reads back the same", () => {
  const c = parseCanvas(obsidian);
  const text = serializeCanvas(c);
  assert.match(text, /^\{\n\t"nodes"/);
  assert.deepEqual(parseCanvas(text), c);
});

test("preset and hex colours", () => {
  assert.equal(cssColor("4"), "#44cf6e");
  assert.equal(cssColor("#abc"), "#abc");
  assert.equal(cssColor(undefined), null);
  assert.equal(cssColor("red; x"), null);
});

test("ids are 16 hex characters", () => {
  assert.match(newId(), /^[0-9a-f]{16}$/);
  assert.notEqual(newId(), newId());
});

test("group helpers", () => {
  const c: CanvasData = parseCanvas(obsidian);
  const group = c.nodes.find((n) => n.id === "g1")!;
  assert.deepEqual(nodesInGroup(c, group).map((n) => n.id), ["a1", "f1"]);
  assert.deepEqual(groupsFirst(c.nodes).map((n) => n.id), ["g1", "a1", "f1"]);
  assert.deepEqual(boundsOf(c.nodes.filter((n) => n.type !== "group"), 10), { x: -10, y: -10, width: 570, height: 220 });
});

test("drawing node survives a parse → serialize round-trip", () => {
  const raw = JSON.stringify({
    nodes: [
      { id: "d1", type: "drawing", x: 10, y: 20, width: 80, height: 40, points: [[0, 0], [10, 20]], stroke: { width: 3, kind: "marker" } },
    ],
    edges: [],
  });
  const c = parseCanvas(raw);
  assert.equal(c.nodes.length, 1);
  assert.equal(c.nodes[0]!.type, "drawing");
  const back = parseCanvas(serializeCanvas(c));
  assert.equal(back.nodes.length, 1);
  assert.deepEqual(back.nodes[0], c.nodes[0]);
});

test("an Obsidian canvas without drawings is unchanged after parse+serialize", () => {
  const c = parseCanvas(obsidian);
  const back = parseCanvas(serializeCanvas(c));
  assert.equal(back.nodes.length, c.nodes.length);
  assert.equal(back.edges.length, c.edges.length);
  assert.ok(back.nodes.every((n) => n.type !== "drawing"));
});

test("groupsFirst puts groups first, drawings last", () => {
  const nodes = [
    { id: "d1", type: "drawing" as const, x: 0, y: 0, width: 1, height: 1, points: [] as [number, number][], stroke: { width: 3, kind: "marker" as const } },
    { id: "g1", type: "group" as const, x: 0, y: 0, width: 100, height: 100 },
    { id: "t1", type: "text" as const, x: 0, y: 0, width: 100, height: 50, text: "hi" },
  ];
  const ordered = groupsFirst(nodes);
  assert.equal(ordered[0]!.id, "g1");
  assert.equal(ordered[1]!.id, "t1");
  assert.equal(ordered[2]!.id, "d1");
});
