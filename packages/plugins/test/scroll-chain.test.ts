import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginHost, type HostAdapter } from "../src/host.ts";
import { parseManifest } from "../src/manifest.ts";

// A stand-in for the browser bits the host touches (see ui-panel.test.ts): fake frames, plus elements whose
// overflow/scroll numbers a test can set, so `scrollNoteBy`'s ancestor walk has something real to find.
type Listener = (event: { data: unknown; source: unknown }) => void;
function fakeDom() {
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const element = (tag: string) => ({
    tag,
    style: { cssText: "" },
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    remove() {},
    contentWindow: tag === "iframe" ? { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } } : undefined,
  });
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {} };
  (globalThis as any).getComputedStyle = (el: any) => ({ overflowY: el?.overflowY ?? "visible" });
  (globalThis as any).document = {
    body: { append() {} },
    head: { querySelector: () => null, querySelectorAll: () => [], append() {} },
    documentElement: {},
    scrollingElement: null as any,
    querySelector: () => null,
    createElement: (tag: string) => {
      const el = element(tag);
      if (tag === "iframe") frames.push(el);
      return el;
    },
  };
  return { frames, from: (frame: any, data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow })) };
}

/** A plain object standing in for a scrollable element: `overflowY: "auto"` plus room to move. */
function scrollableDiv(scrollTop: number, scrollHeight: number, clientHeight: number, parentElement: unknown = null) {
  return { overflowY: "auto", scrollTop, scrollHeight, clientHeight, parentElement };
}

function setup() {
  const dom = fakeDom();
  const host = new PluginHost({ notice() {} } as unknown as HostAdapter, undefined, () => {});
  const start = (id = "board") => {
    void host.load(parseManifest({ id, name: id, version: "1", permissions: ["editor.blocks"] }), "");
    const frame = dom.frames[dom.frames.length - 1]!;
    dom.from(frame, { k: "boot" });
    dom.from(frame, { k: "ready" });
    return frame;
  };
  const call = async (frame: any, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    dom.from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { host, dom, start, call };
}

test("block-scroll walks up from the block's container to the nearest scrollable ancestor and moves it", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "blocks.register", "board");
  const scroller = scrollableDiv(100, 2000, 500);
  const container = { append() {}, parentElement: scroller } as unknown as HTMLElement;
  host.mountBlock("board", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  dom.from(block, { k: "block-scroll", dy: 40 });
  assert.equal(scroller.scrollTop, 140);
  dom.from(block, { k: "block-scroll", dy: -25 });
  assert.equal(scroller.scrollTop, 115);
});

test("block-scroll skips an ancestor with nothing to scroll and keeps looking further up", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "blocks.register", "board");
  const grandparent = scrollableDiv(50, 900, 300);
  const flat = { overflowY: "visible", scrollTop: 0, scrollHeight: 10, clientHeight: 10, parentElement: grandparent };
  const container = { append() {}, parentElement: flat } as unknown as HTMLElement;
  host.mountBlock("board", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  dom.from(block, { k: "block-scroll", dy: 30 });
  assert.equal(grandparent.scrollTop, 80);
});

test("block-scroll falls back to the page itself when no ancestor is scrollable", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "blocks.register", "board");
  const scrolledBy: number[] = [];
  (globalThis as any).document.scrollingElement = { scrollBy: (_x: number, y: number) => scrolledBy.push(y) };
  const container = { append() {}, parentElement: null } as unknown as HTMLElement;
  host.mountBlock("board", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  dom.from(block, { k: "block-scroll", dy: 60 });
  assert.deepEqual(scrolledBy, [60]);
});

test("a garbled dy does nothing", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "blocks.register", "board");
  const scroller = scrollableDiv(10, 1000, 400);
  const container = { append() {}, parentElement: scroller } as unknown as HTMLElement;
  host.mountBlock("board", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  dom.from(block, { k: "block-scroll", dy: "nope" });
  assert.equal(scroller.scrollTop, 10);
});

test("notesChanged tells the block frames, and only those", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "blocks.register", "board");
  const container = { append() {}, parentElement: null } as unknown as HTMLElement;
  host.mountBlock("board", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  const count = (f: any) => f.contentWindow.posted.filter((m: any) => m.k === "vault-changed").length;
  host.notesChanged();
  assert.equal(count(block), 1);
  assert.equal(count(frame), 0);
});
