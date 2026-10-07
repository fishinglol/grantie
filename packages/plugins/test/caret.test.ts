import assert from "node:assert/strict";
import { test } from "node:test";
import { METHOD_PERMISSION } from "../src/api.ts";
import { BlockBridge, PluginHost, type HostAdapter } from "../src/host.ts";
import { API_VERSION, PERMISSIONS, parseManifest, permissionLines } from "../src/manifest.ts";

// A stand-in for the browser bits the host touches (see ui-panel.test.ts): fake frames that record what the host posts to them.
type Listener = (event: { data: unknown; source: unknown }) => void;
function fakeDom() {
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const store = new Map<string, string>();
  const element = (tag: string) => ({
    tag,
    style: { cssText: "" } as Record<string, string>,
    attrs: {} as Record<string, string>,
    srcdoc: "",
    removed: false,
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    remove() { this.removed = true; },
    contentWindow: tag === "iframe" ? { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } } : undefined,
  });
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {}, innerHeight: 800 };
  (globalThis as any).getComputedStyle = () => ({ getPropertyValue: (n: string) => (n === "--accent" ? "#e8871e" : ""), colorScheme: "dark" });
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  (globalThis as any).document = {
    body: { append() {} },
    head: { querySelector: () => null, querySelectorAll: () => [], append() {} },
    documentElement: {},
    querySelector: () => null,
    createElement: (tag: string) => {
      const el = element(tag);
      if (tag === "iframe") frames.push(el);
      return el;
    },
  };
  return { frames, store, from: (frame: any, data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow })) };
}

function setup(permissions: string[] = ["editor.caret"], extra: Record<string, unknown> = {}) {
  const dom = fakeDom();
  const notices: string[] = [];
  const host = new PluginHost({ notice: (m: string) => notices.push(m) } as unknown as HostAdapter);
  void host.load(parseManifest({ id: "fx", name: "FX", version: "1", permissions, ...extra }), "/* code */");
  const main = dom.frames[0]!;
  dom.from(main, { k: "boot" });
  dom.from(main, { k: "ready" });
  const call = async (frame: any, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    dom.from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
    return [...frame.contentWindow.posted].reverse().find((m: any) => m.k === "result" && m.n === n) as { ok: boolean; value?: any; error?: string };
  };
  return { host, dom, main, notices, call };
}

test("API 8 has the editor.caret permission, and each caret method needs it", () => {
  assert.ok(API_VERSION >= 8);
  assert.ok((PERMISSIONS as readonly string[]).includes("editor.caret"));
  for (const m of ["caret.overlay", "caret.setOptions", "caret.getOptions"]) assert.equal(METHOD_PERMISSION[m], "editor.caret");
  assert.ok(permissionLines(parseManifest({ id: "fx", name: "FX", version: "1", permissions: ["editor.caret"] }))[0]!.includes("cannot use the internet"));
});

test("without the permission there is no overlay and the editor is not asked for the caret", async () => {
  const { host, dom, main, call } = setup([]);
  const r = await call(main, "caret.overlay");
  assert.equal(r.ok, false);
  assert.match(r.error!, /editor\.caret/);
  assert.equal(dom.frames.length, 1);
  assert.equal(host.wantsCaret(), false);
});

test("an overlay is one transparent frame over the window that lets every touch through", async () => {
  const { host, dom, main, call } = setup();
  assert.equal(host.wantsCaret(), false);
  assert.equal((await call(main, "caret.overlay")).ok, true);
  assert.equal((await call(main, "caret.overlay")).ok, true, "asking twice does not make a second frame");
  assert.equal(dom.frames.length, 2);
  const overlay = dom.frames[1]!;
  assert.equal(overlay.attrs.sandbox, "allow-scripts", "no allow-same-origin: it cannot touch the app");
  assert.match(overlay.style.cssText, /pointer-events:none/);
  assert.match(overlay.style.cssText, /position:fixed/);
  assert.equal(host.wantsCaret(), true);
});

test("the overlay can never use the internet, even when the plugin has the network permission", async () => {
  const { main, dom, call } = setup(["editor.caret", "network"], { connect: ["wss://relay.example.com"] });
  assert.match(main.srcdoc, /connect-src/, "the plugin's own frame may");
  await call(main, "caret.overlay");
  const overlay = dom.frames[1]!;
  assert.doesNotMatch(overlay.srcdoc, /connect-src/);
  assert.match(overlay.srcdoc, /default-src 'none'/);
  assert.match(overlay.srcdoc, /img-src data:/);
});

test("the overlay starts with the plugin's code, the theme, the saved options and the last caret", async () => {
  const { host, dom, main, call } = setup();
  await call(main, "caret.setOptions", { shape: "box" });
  await call(main, "caret.overlay");
  const overlay = dom.frames[1]!;
  const caret = { x: 10, y: 20, width: 8, height: 24 };
  host.caretEvent({ type: "move", caret, selecting: false, scroll: false });
  dom.from(overlay, { k: "boot" });
  const init = overlay.contentWindow.posted.find((m: any) => m.k === "init");
  assert.equal(init.code, "/* code */");
  assert.deepEqual(init.overlay.options, { shape: "box" });
  assert.deepEqual(init.overlay.caret, { type: "move", caret, selecting: false, scroll: false });
  assert.equal(init.overlay.vars["--accent"], "#e8871e");
});

test("caret events reach the overlay, and only the overlay", async () => {
  const { host, dom, main, call } = setup();
  await call(main, "caret.overlay");
  const before = main.contentWindow.posted.length;
  host.caretEvent({ type: "type", text: "a", caret: null });
  assert.deepEqual(dom.frames[1]!.contentWindow.posted.at(-1), { k: "caret", event: { type: "type", text: "a", caret: null } });
  assert.equal(main.contentWindow.posted.length, before, "the plugin's other frame (which may have the network) is never told what is typed");
});

test("the block bridge hands the editor's caret events to the host", async () => {
  const { host, dom, main, call } = setup();
  const bridge = new BlockBridge();
  assert.equal(bridge.wantsCaret(), false);
  bridge.host = host;
  assert.equal(bridge.wantsCaret(), false);
  await call(main, "caret.overlay");
  assert.equal(bridge.wantsCaret(), true);
  bridge.caret({ type: "enter", caret: null });
  assert.equal(dom.frames[1]!.contentWindow.posted.at(-1).event.type, "enter");
});

test("the overlay is refused every call, so what it is told cannot be sent anywhere", async () => {
  const { host, dom, main, call, notices } = setup(["editor.caret", "editor.read", "vault.write"]);
  await call(main, "caret.overlay");
  const overlay = dom.frames[1]!;
  const before = overlay.contentWindow.posted.length;
  dom.from(overlay, { k: "call", n: 5, method: "vault.write", args: ["stolen.md", "x"] });
  dom.from(overlay, { k: "call", n: 6, method: "notice", args: ["hi"] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(overlay.contentWindow.posted.length, before, "nothing was answered");
  assert.deepEqual(notices, []);
  assert.equal(host.wantsCaret(), true);
});

test("options are checked, kept on the device, sent to a running overlay and read back", async () => {
  const { dom, main, call } = setup();
  assert.equal((await call(main, "caret.getOptions")).value, null);
  await call(main, "caret.overlay");
  assert.equal((await call(main, "caret.setOptions", { color: "#ff0000", effects: ["trail"] })).ok, true);
  assert.deepEqual(dom.frames[1]!.contentWindow.posted.at(-1), { k: "caret-options", options: { color: "#ff0000", effects: ["trail"] } });
  assert.deepEqual((await call(main, "caret.getOptions")).value, { color: "#ff0000", effects: ["trail"] });
  assert.equal(dom.store.get("granite-plugin-options:fx"), '{"color":"#ff0000","effects":["trail"]}');
  const tooBig = await call(main, "caret.setOptions", { x: "y".repeat(20_001) });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error!, /20000/);
});

test("options saved on an earlier run are there when the plugin starts again", async () => {
  const first = setup();
  await first.call(first.main, "caret.setOptions", { shape: "underline" });
  const store = first.dom.store;
  const second = setup();
  for (const [k, v] of store) second.dom.store.set(k, v);
  assert.deepEqual((await second.call(second.main, "caret.getOptions")).value, { shape: "underline" });
});

test("stopping the plugin removes its overlay, and a failing overlay is removed and reported", async () => {
  const { host, dom, main, call, notices } = setup();
  await call(main, "caret.overlay");
  dom.from(dom.frames[1]!, { k: "error", message: "boom", fatal: true });
  assert.equal(dom.frames[1]!.removed, true);
  assert.equal(host.wantsCaret(), false);
  assert.deepEqual(notices, ["FX: boom"]);
  await call(main, "caret.overlay");
  assert.equal(dom.frames.length, 3, "it can be asked for again");
  host.unload("fx");
  assert.equal(dom.frames[2]!.removed, true);
});

test("the overlay is hidden while the app shows what a plugin must not cover (consent, delete confirmations)", async () => {
  const { host, dom, main, call } = setup();
  await call(main, "caret.overlay");
  const overlay = dom.frames[1]!;
  host.pauseStyles(true);
  assert.equal(overlay.style.display, "none", "taken out of the page, not just made invisible: WebKit still gives an invisible frame the wheel");
  host.pauseStyles(false);
  assert.equal(overlay.style.display, "");
});

test("an overlay made while the app is showing such a screen starts hidden", async () => {
  const { host, dom, main, call } = setup();
  host.pauseStyles(true);
  await call(main, "caret.overlay");
  assert.equal(dom.frames[1]!.style.display, "none");
});

// WebKit gives the full-window overlay the mouse wheel even though it lets clicks through, which froze every scroll in the Mac app.
// The overlay passes each wheel to the host, which scrolls what is under the pointer.
function underPointer(el: unknown) {
  (globalThis as any).document.elementFromPoint = () => el;
  (globalThis as any).WheelEvent = class {
    type: string;
    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  (globalThis as any).getComputedStyle = (node: any) => ({ overflowY: node?.overflowY ?? "visible", overflowX: node?.overflowX ?? "visible", getPropertyValue: () => "" });
}
const scroller = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({
  overflowY: "auto", scrollTop, scrollHeight, clientHeight, scrollLeft: 0, scrollWidth: 0, clientWidth: 0, parentElement: null,
  scrollBy(_x: number, y: number) { this.scrollTop += y; },
});

test("the overlay frame passes the wheel on to the host", async () => {
  const { dom, main, call } = setup();
  await call(main, "caret.overlay");
  assert.match(dom.frames[1]!.srcdoc, /overlay-wheel/);
  assert.doesNotMatch(main.srcdoc ?? "", /overlay-wheel/, "only the overlay: other frames get the wheel themselves");
});

test("a wheel over the overlay scrolls the note under the pointer", async () => {
  const { dom, main, call } = setup();
  await call(main, "caret.overlay");
  const note = scroller(100, 2000, 600);
  const line = { parentElement: note, dispatchEvent: () => true };
  underPointer(line);
  dom.from(dom.frames[1]!, { k: "overlay-wheel", x: 400, y: 300, dx: 0, dy: 60 });
  assert.equal(note.scrollTop, 160);
});

test("what is under the pointer gets the wheel first: the canvas zooms instead of the page scrolling", async () => {
  const { dom, main, call } = setup();
  await call(main, "caret.overlay");
  const page = scroller(0, 2000, 600);
  const seen: any[] = [];
  const board = { parentElement: page, dispatchEvent: (e: any) => (seen.push(e), false) }; // handled (preventDefault)
  underPointer(board);
  dom.from(dom.frames[1]!, { k: "overlay-wheel", x: 10, y: 20, dx: 0, dy: -8, ctrl: true });
  assert.equal(page.scrollTop, 0);
  assert.deepEqual([seen[0].type, seen[0].deltaY, seen[0].ctrlKey, seen[0].clientX], ["wheel", -8, true, 10]);
});

test("a wheel over a plugin block is handed to that block, in its own coordinates", async () => {
  const dom = fakeDom();
  const host = new PluginHost({ notice() {} } as unknown as HostAdapter);
  void host.load(parseManifest({ id: "fx", name: "FX", version: "1", permissions: ["editor.caret", "editor.blocks"] }), "");
  const main = dom.frames[0]!;
  dom.from(main, { k: "boot" });
  dom.from(main, { k: "ready" });
  dom.from(main, { k: "call", n: 1, method: "caret.overlay", args: [] });
  dom.from(main, { k: "call", n: 2, method: "blocks.register", args: ["board"] });
  await new Promise((r) => setTimeout(r, 0));
  (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  host.mountBlock("board", { append() {} } as unknown as HTMLElement, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[2]!;
  block.getBoundingClientRect = () => ({ left: 100, top: 50 });
  underPointer(block);
  dom.from(dom.frames[1]!, { k: "overlay-wheel", x: 130, y: 90, dx: 0, dy: 25 });
  assert.deepEqual(block.contentWindow.posted.at(-1), { k: "scroll-at", x: 30, y: 40, dx: 0, dy: 25, ctrl: false, shift: false, meta: false });
});

test("a garbled wheel, or one from a frame that is not an overlay, does nothing", async () => {
  const { dom, main, call } = setup();
  await call(main, "caret.overlay");
  const note = scroller(100, 2000, 600);
  underPointer({ parentElement: note, dispatchEvent: () => true });
  dom.from(dom.frames[1]!, { k: "overlay-wheel", x: 1, y: 1, dx: 0, dy: "lots" });
  dom.from(main, { k: "overlay-wheel", x: 1, y: 1, dx: 0, dy: 60 });
  assert.equal(note.scrollTop, 100);
});

// Inside a block (a Cards note, a Simple Table cell) the caret is in the block's own frame, which the note can't see into.
// The block frame reports it; the host moves it into window pixels and decides who has the caret: the note or a block.
async function withBlock(opts: { overlay?: boolean } = {}) {
  const dom = fakeDom();
  const host = new PluginHost({ notice() {} } as unknown as HostAdapter);
  void host.load(parseManifest({ id: "fx", name: "FX", version: "1", permissions: ["editor.caret", "editor.blocks"] }), "");
  const main = dom.frames[0]!;
  dom.from(main, { k: "boot" });
  dom.from(main, { k: "ready" });
  dom.from(main, { k: "call", n: 1, method: "blocks.register", args: ["table"] });
  if (opts.overlay !== false) dom.from(main, { k: "call", n: 2, method: "caret.overlay", args: [] });
  await new Promise((r) => setTimeout(r, 0));
  const mount = host.mountBlock("table", { append() {}, classList: { remove() {} } } as unknown as HTMLElement, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames.at(-1)!;
  block.getBoundingClientRect = () => ({ left: 100, top: 200 });
  dom.from(block, { k: "boot" });
  const overlay = opts.overlay === false ? null : dom.frames[1]!;
  const told = () => (overlay ? overlay.contentWindow.posted.filter((m: any) => m.k === "caret").map((m: any) => m.event) : []);
  return { host, dom, block, mount, overlay, told };
}
const at = (x: number, y: number) => ({ x, y, width: 8, height: 18 });

test("block frames get the caret script, and are told to report only while a plugin draws the caret", async () => {
  const { block } = await withBlock();
  assert.match(block.srcdoc, /caret-want/);
  assert.deepEqual(block.contentWindow.posted.filter((m: any) => m.k === "caret-want").at(-1), { k: "caret-want", on: true, hide: false });
  const without = await withBlock({ overlay: false });
  assert.deepEqual(without.block.contentWindow.posted.filter((m: any) => m.k === "caret-want").at(-1), { k: "caret-want", on: false, hide: false });
});

test("a caret in a block reaches the overlay in window pixels, and so does typing there", async () => {
  const { dom, block, told } = await withBlock();
  dom.from(block, { k: "block-caret", event: { type: "move", caret: at(10, 5), selecting: false, scroll: false } });
  dom.from(block, { k: "block-caret", event: { type: "type", text: "a", caret: at(18, 5) } });
  assert.deepEqual(told(), [
    { type: "move", caret: at(110, 205), selecting: false, scroll: false },
    { type: "type", text: "a", caret: at(118, 205) },
  ]);
});

test("whoever has the caret wins: a late 'no caret' from the note or the block that lost it changes nothing", async () => {
  const { host, dom, block, told } = await withBlock();
  host.caretEvent({ type: "move", caret: at(1, 1), selecting: false, scroll: false }); // typing in the note
  dom.from(block, { k: "block-caret", event: { type: "move", caret: at(10, 5), selecting: false, scroll: false } }); // clicked into a cell
  host.caretEvent({ type: "move", caret: null, selecting: false, scroll: false }); // the note's blur, arriving late
  host.caretEvent({ type: "type", text: "z", caret: null });
  host.caretEvent({ type: "move", caret: at(2, 2), selecting: false, scroll: false }); // back in the note
  dom.from(block, { k: "block-caret", event: { type: "move", caret: null, selecting: false, scroll: false } }); // the cell's blur, late
  dom.from(block, { k: "block-caret", event: { type: "type", text: "q", caret: at(0, 0) } });
  assert.deepEqual(told().map((e: any) => e.caret), [at(1, 1), at(110, 205), at(2, 2)]);
});

test("a block that had the caret and goes away (the note changed under it) takes the caret with it", async () => {
  const { dom, block, mount, told } = await withBlock();
  dom.from(block, { k: "block-caret", event: { type: "move", caret: at(10, 5), selecting: false, scroll: false } });
  mount.destroy();
  assert.deepEqual(told().at(-1), { type: "move", caret: null, selecting: false, scroll: false });
});

test("a hidden block (kept alive behind another pane or sheet) never claims or drops the caret", async () => {
  const { host, dom, block, told } = await withBlock();
  dom.from(block, { k: "block-caret", event: { type: "move", caret: at(10, 5), selecting: false, scroll: false } });
  // A second "table" block mounts hidden (its container reports no client rects, as a `display:none` kept-alive
  // pane's would) and fires a stray report, the way every loaded block does when `caret-want` re-broadcasts on boot.
  const hiddenContainer = { append() {}, classList: { remove() {} }, getClientRects: () => [] } as unknown as HTMLElement;
  host.mountBlock("table", hiddenContainer, "", { save() {}, remove() {}, edit() {} });
  const hidden = dom.frames.at(-1)!;
  hidden.getBoundingClientRect = () => ({ left: 999, top: 999 });
  dom.from(hidden, { k: "boot" });
  dom.from(hidden, { k: "block-caret", event: { type: "move", caret: at(1, 1), selecting: false, scroll: false } });
  assert.deepEqual(told().at(-1), { type: "move", caret: at(110, 205), selecting: false, scroll: false }); // still the visible block's
  dom.from(hidden, { k: "block-caret", event: { type: "move", caret: null, selecting: false, scroll: false } }); // its own "gone"
  assert.deepEqual(told().at(-1), { type: "move", caret: at(110, 205), selecting: false, scroll: false }); // unaffected
});

test("the caret mirror of a text field copies its alignment and inner width (a centred table header)", async () => {
  const { block } = await withBlock();
  assert.match(block.srcdoc, /"boxSizing", "textAlign"/);
  assert.match(block.srcdoc, /width:" \+ el\.clientWidth/);
});

test("blocks hide their own caret when the plugin hid the note's", async () => {
  const { host, block } = await withBlock();
  (globalThis as any).document.querySelector = (sel: string) => (sel === ".live-editor .cm-content" ? {} : null);
  (globalThis as any).getComputedStyle = () => ({ caretColor: "rgba(0, 0, 0, 0)", getPropertyValue: () => "" });
  host.pauseStyles(false); // anything that re-tells the blocks
  assert.deepEqual(block.contentWindow.posted.filter((m: any) => m.k === "caret-want").at(-1), { k: "caret-want", on: true, hide: true });
  host.pauseStyles(true);
  assert.deepEqual(block.contentWindow.posted.filter((m: any) => m.k === "caret-want").at(-1), { k: "caret-want", on: false, hide: false });
});

test("a garbled caret from a block, or one while nobody draws the caret, goes nowhere", async () => {
  const { dom, block, told } = await withBlock();
  dom.from(block, { k: "block-caret", event: { type: "move", caret: { x: "1", y: 2, width: 3, height: 4 } } });
  dom.from(block, { k: "block-caret", event: { type: "boom", caret: null } });
  dom.from(block, { k: "block-caret", event: { type: "type", text: 5, caret: at(1, 1) } });
  assert.deepEqual(told(), []);
  const without = await withBlock({ overlay: false });
  without.dom.from(without.block, { k: "block-caret", event: { type: "move", caret: at(1, 1), selecting: false, scroll: false } });
  assert.equal(without.host.wantsCaret(), false);
});
