import assert from "node:assert/strict";
import { test } from "node:test";
import { PluginHost, type HostAdapter } from "../src/host.ts";
import { parseManifest } from "../src/manifest.ts";

// A stand-in for the browser bits the host touches (see ui-panel.test.ts): fake frames that record what the host posts to them.
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
    append() {},
    classList: { remove() {} },
    contentWindow: tag === "iframe" ? { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } } : undefined,
  });
  (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "" });
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {} };
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
  return { frames, from: (frame: any, data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow })) };
}

function setup() {
  const dom = fakeDom();
  const notices: string[] = [];
  let blocksChanged = 0;
  const host = new PluginHost({ notice: (m: string) => notices.push(m) } as unknown as HostAdapter, undefined, () => blocksChanged++);
  const start = (id: string, code = "") => {
    void host.load(parseManifest({ id, name: id, version: "1", permissions: ["editor.blocks", "editor.input", "editor.links", "ui.panel"] }), code);
    const frame = dom.frames[dom.frames.length - 1]!;
    dom.from(frame, { k: "boot" });
    dom.from(frame, { k: "ready" });
    return frame;
  };
  const call = async (frame: any, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    dom.from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
    return [...frame.contentWindow.posted].reverse().find((m: any) => m.k === "result" && m.n === n) as { ok: boolean; value?: unknown; error?: string };
  };
  return { host, dom, notices, start, call, blocksChanged: () => blocksChanged };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const lastPosted = (frame: any, k: string) => [...frame.contentWindow.posted].reverse().find((m: any) => m.k === k);

test("two plugins drawing the same fence: the second is refused, not silently overridden", async () => {
  const { start, call } = setup();
  const a = start("cards-a");
  const b = start("cards-b");
  assert.equal((await call(a, "blocks.register", "cards")).ok, true);
  const r = await call(b, "blocks.register", "cards");
  assert.equal(r.ok, false);
  assert.match(r.error!, /"cards" blocks are already drawn by "cards-a"/);
});

test("a plugin re-registering its own language (a second block type, or a dev reload) is fine", async () => {
  const { start, call, blocksChanged } = setup();
  const a = start("multi");
  assert.equal((await call(a, "blocks.register", "sheet")).ok, true);
  assert.equal((await call(a, "blocks.register", "sheet")).ok, true);
  assert.equal((await call(a, "blocks.register", "grid")).ok, true);
  assert.ok(blocksChanged() >= 3);
});

test("once the first plugin is stopped, another may take the language", async () => {
  const { host, start, call } = setup();
  const a = start("cards-a");
  await call(a, "blocks.register", "cards");
  host.unload("cards-a");
  const b = start("cards-b");
  assert.equal((await call(b, "blocks.register", "cards")).ok, true);
});

// Plugins start in parallel, so which one registers first differs between launches (and between desktop and phone).
// Whatever the order, the plugin whose id sorts first must end up with the shared thing.

test("same fence, either start order: the plugin whose id sorts first draws it, and the other is told", async () => {
  for (const order of [["cards-a", "cards-b"], ["cards-b", "cards-a"]]) {
    const { host, notices, start, call } = setup();
    const frames = Object.fromEntries(order.map((id) => [id, start(id)]));
    const results = [];
    for (const id of order) results.push(await call(frames[id], "blocks.register", "cards"));
    assert.equal(host.blockLabel("cards"), "cards-a", `order ${order}`);
    const told = [...results.flatMap((r) => (r.ok ? [] : [`cards-b: ${r.error}`])), ...notices];
    assert.deepEqual(told, ['cards-b: "cards" blocks are already drawn by "cards-a"'], `order ${order}`);
  }
});

test("blocks already on screen move to the rightful owner when it starts late, and back when it stops", async () => {
  const { host, dom, start, call } = setup();
  const b = start("cards-b", "B-CODE");
  await call(b, "blocks.register", "cards");
  const container = document.createElement("div") as unknown as HTMLElement;
  const mount = host.mountBlock("cards", container, "{}", { save() {}, remove() {}, edit() {} });
  const codeIn = (frame: any) => {
    dom.from(frame, { k: "boot" });
    return lastPosted(frame, "init")?.code;
  };
  assert.equal(codeIn(dom.frames.at(-1)), "B-CODE");

  const a = start("cards-a", "A-CODE");
  await call(a, "blocks.register", "cards");
  const handedOver = dom.frames.at(-1);
  assert.equal(codeIn(handedOver), "A-CODE");
  mount.update("{\"x\":1}");
  assert.equal(lastPosted(handedOver, "block-update")?.source, "{\"x\":1}", "updates reach the new frame");

  host.unload("cards-a");
  assert.equal(codeIn(dom.frames.at(-1)), "B-CODE");
  assert.equal(host.blockLabel("cards"), "cards-b");
});

test("same typed trigger, either start order: one owner, the id that sorts first; // is shared", async () => {
  for (const order of [["fx-a", "fx-b"], ["fx-b", "fx-a"]]) {
    const { host, notices, start, call } = setup();
    const frames = Object.fromEntries(order.map((id) => [id, start(id)]));
    const results = [];
    for (const id of order) results.push(await call(frames[id], "input.register", "trigger", "::"));
    assert.equal(results.filter((r) => !r.ok).length + notices.length, 1, `order ${order}: the loser is told once`);
    void host.runInput("trigger", { text: "::" });
    await tick();
    assert.ok(lastPosted(frames["fx-a"], "input-run"), `order ${order}: fx-a is asked`);
    assert.equal(lastPosted(frames["fx-b"], "input-run"), undefined, `order ${order}: fx-b is not`);
    for (const id of order) assert.equal((await call(frames[id], "input.register", "trigger", "//")).ok, true);
  }
});

test("paste is offered to each plugin in id order until one takes it", async () => {
  const { host, dom, start, call } = setup();
  const b = start("paste-b");
  const a = start("paste-a");
  await call(b, "input.register", "paste", "");
  await call(a, "input.register", "paste", "");
  const pasted = host.runInput("paste", { text: "1\t2", html: "" });
  await tick();
  const toA = lastPosted(a, "input-run");
  assert.equal(lastPosted(b, "input-run"), undefined, "paste-a is asked first");
  dom.from(a, { k: "input-done", n: toA.n, value: null }); // declines
  await tick();
  const toB = lastPosted(b, "input-run");
  assert.equal(toB?.text, "1\t2");
  dom.from(b, { k: "input-done", n: toB.n, value: "| 1 | 2 |" });
  assert.equal(await pasted, "| 1 | 2 |");
});

test("paste taken by the first plugin never reaches the second", async () => {
  const { host, dom, start, call } = setup();
  const a = start("paste-a");
  const b = start("paste-b");
  await call(a, "input.register", "paste", "");
  await call(b, "input.register", "paste", "");
  const pasted = host.runInput("paste", { text: "1\t2", html: "" });
  await tick();
  dom.from(a, { k: "input-done", n: lastPosted(a, "input-run").n, value: "taken" });
  assert.equal(await pasted, "taken");
  assert.equal(lastPosted(b, "input-run"), undefined);
});

test("two plugins naming the same site: the same one draws the chip whatever the start order", async () => {
  const provider = (id: string) => ({ id, name: id, label: id, hosts: ["example.com"], color: "#112233", icon: '<svg viewBox="0 0 1 1"></svg>' });
  for (const order of [["chips-a", "chips-b"], ["chips-b", "chips-a"]]) {
    const { host, start, call } = setup();
    const frames = Object.fromEntries(order.map((id) => [id, start(id)]));
    for (const id of order) assert.equal((await call(frames[id], "links.register", [provider("site")])).ok, true);
    assert.equal(host.linkChip("https://example.com/x")?.key, "chips-a:site", `order ${order}`);
  }
});

test("buttons at the top of a note keep one order (by plugin name), not start order", async () => {
  const icon = '<svg viewBox="0 0 1 1"></svg>';
  for (const order of [["zeta", "alpha"], ["alpha", "zeta"]]) {
    const { host, start, call } = setup();
    const frames = Object.fromEntries(order.map((id) => [id, start(id)]));
    for (const id of order) await call(frames[id], "ui.button", id, icon);
    assert.deepEqual(host.headerButtons().map((b) => b.pluginId), ["alpha", "zeta"], `order ${order}`);
  }
});
