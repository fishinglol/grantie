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
