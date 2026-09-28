import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { METHOD_PERMISSION } from "../src/api.ts";
import { API_VERSION, parseManifest } from "../src/manifest.ts";

const dir = new URL("../../../examples/plugins/cursor-fx/", import.meta.url);
const code = readFileSync(new URL("main.js", dir), "utf8");
const manifest = parseManifest(JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Run the plugin the way a frame does, with a `granite` that records what it is asked. */
function run(inOverlay: boolean) {
  const calls: string[] = [];
  const hooks: Record<string, any> = {};
  const granite = {
    caret: {
      inOverlay,
      overlay: () => void calls.push("caret.overlay"),
      getOptions: () => (calls.push("caret.getOptions"), Promise.resolve(null)),
      setOptions: () => (calls.push("caret.setOptions"), Promise.resolve()),
    },
    editor: { setStyle: (css: string) => (calls.push(`editor.setStyle ${css}`), Promise.resolve()) },
    commands: { add: (c: { id: string }) => void calls.push(`commands.add ${c.id}`) },
    ui: { headerButton: () => (calls.push("ui.headerButton"), Promise.resolve()) },
    notice: () => {},
  };
  vm.runInNewContext(code, { granite, __cursorFxTest: hooks, console });
  return { calls, hooks };
}

test("the manifest is valid, asks for the caret API and only what the plugin uses", () => {
  assert.equal(manifest.id, "cursor-fx");
  assert.ok((manifest.minApiVersion ?? 1) <= API_VERSION);
  assert.deepEqual([...manifest.permissions].sort(), ["editor.caret", "editor.style", "ui.panel"]);
  assert.equal(METHOD_PERMISSION["caret.overlay"], "editor.caret");
});

test("in the plugin's own frame it asks for the overlay, hides the editor's caret and adds its window", () => {
  const { calls } = run(false);
  assert.ok(calls.includes("caret.overlay"));
  assert.ok(calls.includes("ui.headerButton"));
  assert.ok(calls.includes("commands.add reset"));
  const style = calls.find((c) => c.startsWith("editor.setStyle"))!;
  assert.match(style, /caret-color:transparent/);
  assert.doesNotMatch(style, /\.note-title/, "the title box keeps its own caret");
});

test("in the overlay frame it only draws: no calls, which the host would refuse anyway", () => {
  const { calls } = run(true);
  assert.deepEqual(calls, ["caret.overlay"]);
});

test("options from storage or the settings window are cleaned before they reach a style", () => {
  const { clean, DEFAULTS } = run(true).hooks;
  assert.deepEqual(plain(clean(null)), plain(DEFAULTS));
  assert.deepEqual(plain(clean("nope")), plain(DEFAULTS));
  const evil = plain(clean({ shape: "box; x", color: "red; background:url(//evil)", blink: "x", thickness: 999, opacity: -4, speed: "fast", glide: "yes", trail: true }));
  assert.equal(evil.shape, DEFAULTS.shape);
  assert.equal(evil.color, "", "only #rrggbb is a colour");
  assert.equal(evil.blink, DEFAULTS.blink);
  assert.equal(evil.thickness, 8, "numbers are kept inside their range");
  assert.equal(evil.opacity, 0.2);
  assert.equal(evil.speed, DEFAULTS.speed);
  assert.equal(evil.glide, DEFAULTS.glide, "a flag must be a real boolean");
  assert.equal(evil.trail, true);
  assert.equal(clean({ color: "#22D3EE" }).color, "#22d3ee");
});
