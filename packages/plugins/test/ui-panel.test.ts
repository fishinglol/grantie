import assert from "node:assert/strict";
import { test } from "node:test";
import { METHOD_PERMISSION } from "../src/api.ts";
import { PluginHost, type HostAdapter } from "../src/host.ts";
import { checkSvgIcon } from "../src/links.ts";
import { API_VERSION, PERMISSIONS, parseManifest } from "../src/manifest.ts";

// A stand-in for the browser bits the host touches: fake frames (that record what the host posts to them) and fake elements.
type Listener = (event: { data: unknown; source: unknown }) => void;
function fakeDom() {
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const body = { children: [] as any[], append(el: any) { this.children.push(el); } };
  const head = {
    children: [] as any[],
    querySelector: () => head.children.find((c) => c.tag === "style") ?? null,
    querySelectorAll: () => head.children.filter((c) => c.tag === "style"), // arrays have forEach, like a NodeList
    append(el: any) { this.children.push(el); },
  };
  const element = (tag: string) => ({
    tag,
    className: "",
    style: { cssText: "", height: "" } as Record<string, string>,
    attrs: {} as Record<string, string>,
    handlers: {} as Record<string, () => void>,
    removed: false,
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener(name: string, fn: () => void) { this.handlers[name] = fn; },
    remove() { this.removed = true; },
    contentWindow: tag === "iframe" ? { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } } : undefined,
  });
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {}, innerHeight: 800 };
  (globalThis as any).getComputedStyle = () => ({ getPropertyValue: (n: string) => (n === "--panel" ? "#222" : ""), colorScheme: "dark" });
  (globalThis as any).document = {
    body,
    head,
    documentElement: {},
    querySelector: () => null,
    createElement: (tag: string) => {
      const el = element(tag);
      if (tag === "iframe") frames.push(el);
      return el;
    },
  };
  return { frames, body, head, from: (frame: any, data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow })) };
}

function setup(perms: string[] = ["ui.panel"], copyText?: (t: string) => Promise<void>) {
  const dom = fakeDom();
  const notices: string[] = [];
  let buttonChanges = 0;
  const host = new PluginHost({ notice: (m: string) => notices.push(m), ...(copyText && { copyText }) } as unknown as HostAdapter, undefined, undefined, () => buttonChanges++);
  const start = (id = "shareable", permissions = perms) => {
    void host.load(parseManifest({ id, name: id, version: "1", permissions }), "");
    const frame = dom.frames[dom.frames.length - 1]!;
    dom.from(frame, { k: "boot" });
    dom.from(frame, { k: "ready" });
    return frame;
  };
  const call = async (frame: any, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    dom.from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
    return [...frame.contentWindow.posted].reverse().find((m: any) => m.k === "result" && m.n === n) as { ok: boolean; value?: any; error?: string };
  };
  return { host, dom, notices, start, call, changes: () => buttonChanges };
}

const ICON = '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';

test("API 7 has the ui.panel permission and every ui method needs it", () => {
  assert.ok(API_VERSION >= 7);
  assert.ok((PERMISSIONS as readonly string[]).includes("ui.panel"));
  for (const m of ["ui.button", "ui.badge", "ui.copy"]) assert.equal(METHOD_PERMISSION[m], "ui.panel");
});

test("a plugin without ui.panel gets no button", async () => {
  const { host, start, call } = setup([]);
  const frame = start();
  const r = await call(frame, "ui.button", "Share", ICON);
  assert.equal(r.ok, false);
  assert.match(r.error!, /ui\.panel/);
  assert.deepEqual(host.headerButtons(), []);
});

test("a button is listed with its icon as a data URI, and the apps are told", async () => {
  const { host, start, call, changes } = setup();
  const frame = start();
  assert.equal((await call(frame, "ui.button", "Share", ICON)).ok, true);
  const [b] = host.headerButtons();
  assert.equal(b!.pluginId, "shareable");
  assert.equal(b!.title, "Share");
  assert.equal(b!.badge, null);
  assert.ok(b!.icon.startsWith("data:image/svg+xml,"));
  assert.ok(decodeURIComponent(b!.icon).includes('xmlns="http://www.w3.org/2000/svg"'), "the namespace is added, so the icon draws as an image");
  assert.ok(changes() >= 1);
});

test("a button's title and icon are checked", async () => {
  const { host, start, call } = setup();
  const frame = start();
  assert.equal((await call(frame, "ui.button", "", ICON)).ok, false);
  assert.equal((await call(frame, "ui.button", "x".repeat(41), ICON)).ok, false);
  assert.equal((await call(frame, "ui.button", "Share", '<svg><script>alert(1)</script></svg>')).ok, false);
  assert.equal((await call(frame, "ui.button", "Share", '<svg><image href="https://x"/></svg>')).ok, false);
  assert.equal((await call(frame, "ui.button", "Share", "not svg")).ok, false);
  assert.deepEqual(host.headerButtons(), []);
  assert.throws(() => checkSvgIcon(5, "x"));
});

test("the badge is a colour or null", async () => {
  const { host, start, call } = setup();
  const frame = start();
  await call(frame, "ui.button", "Share", ICON);
  assert.equal((await call(frame, "ui.badge", "#30A46C")).ok, true);
  assert.equal(host.headerButtons()[0]!.badge, "#30a46c");
  assert.equal((await call(frame, "ui.badge", "red")).ok, false);
  assert.equal((await call(frame, "ui.badge", null)).ok, true);
  assert.equal(host.headerButtons()[0]!.badge, null);
});

test("pressing the button shows the plugin's frame as a window; closing hides it again", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "ui.button", "Share", ICON);
  host.openPanel("shareable");
  assert.equal(frame.className, "granite-panel-frame");
  assert.equal(dom.body.children.filter((c: any) => c.className === "granite-panel-backdrop").length, 1);
  assert.equal(dom.head.children.length, 1); // the window's stylesheet, added once
  const opened = frame.contentWindow.posted.find((m: any) => m.k === "panel-open");
  assert.equal(opened.vars["--panel"], "#222");

  dom.from(frame, { k: "panel-resize", height: 9999 });
  assert.equal(frame.style.height, "720px"); // 90% of an 800px screen
  dom.from(frame, { k: "panel-resize", height: 10 });
  assert.equal(frame.style.height, "120px");

  dom.from(frame, { k: "panel-close" });
  assert.equal(frame.className, "");
  assert.match(frame.style.cssText, /display:none/);
  assert.ok(dom.body.children.find((c: any) => c.className === "granite-panel-backdrop").removed);
  assert.ok(frame.contentWindow.posted.some((m: any) => m.k === "panel-close"));

  host.openPanel("shareable");
  assert.equal(dom.head.children.length, 1, "the stylesheet is not added twice");
});

test("tapping outside the window closes it; opening another plugin's window closes the first", async () => {
  const { host, dom, start, call } = setup();
  const a = start("a");
  const b = start("b");
  await call(a, "ui.button", "A", ICON);
  await call(b, "ui.button", "B", ICON);
  host.openPanel("a");
  const backdrop = dom.body.children.find((c: any) => c.className === "granite-panel-backdrop");
  backdrop.handlers.pointerdown!();
  assert.equal(a.className, "");
  host.openPanel("a");
  host.openPanel("b");
  assert.equal(a.className, "");
  assert.equal(b.className, "granite-panel-frame");
});

test("a plugin can't resize or close a window that is not its own", async () => {
  const { host, dom, start, call } = setup();
  const a = start("a");
  const b = start("b");
  await call(a, "ui.button", "A", ICON);
  await call(b, "ui.button", "B", ICON);
  host.openPanel("a");
  dom.from(b, { k: "panel-resize", height: 300 });
  dom.from(b, { k: "panel-close" });
  assert.equal(a.className, "granite-panel-frame");
  assert.notEqual(b.style.height, "300px");
});

test("switching a plugin off closes its window and takes its button away", async () => {
  const { host, dom, start, call } = setup();
  const frame = start();
  await call(frame, "ui.button", "Share", ICON);
  host.openPanel("shareable");
  host.unload("shareable");
  assert.deepEqual(host.headerButtons(), []);
  assert.ok(dom.body.children.find((c: any) => c.className === "granite-panel-backdrop").removed);
});

test("openPanel does nothing for a plugin with no button", () => {
  const { host, dom, start } = setup();
  start();
  host.openPanel("shareable");
  host.openPanel("nobody");
  assert.equal(dom.body.children.filter((c: any) => c.className === "granite-panel-backdrop").length, 0);
});

test("copy goes through the app's clipboard, and is refused when too long or without the permission", async () => {
  const copied: string[] = [];
  const { start, call } = setup(["ui.panel"], async (t) => void copied.push(t));
  const frame = start();
  assert.equal((await call(frame, "ui.copy", "granite-live://host/room")).ok, true);
  assert.deepEqual(copied, ["granite-live://host/room"]);
  assert.equal((await call(frame, "ui.copy", "x".repeat(10_001))).ok, false);
  const plain = setup([], async (t) => void copied.push(t));
  assert.equal((await plain.call(plain.start(), "ui.copy", "hi")).ok, false);
  assert.equal(copied.length, 1);
});

test("a block frame can't add a button or set the badge", async () => {
  const { host, dom, start, call } = setup(["ui.panel", "editor.blocks"]);
  const frame = start();
  await call(frame, "blocks.register", "share");
  const container = { append() {} } as unknown as HTMLElement;
  host.mountBlock("share", container, "", { save() {}, remove() {}, edit() {} });
  const block = dom.frames[dom.frames.length - 1];
  assert.notEqual(block, frame);
  assert.equal((await call(block, "ui.button", "Sneaky", ICON)).ok, false);
  assert.equal((await call(block, "ui.badge", "#ff0000")).ok, false);
  assert.deepEqual(host.headerButtons(), []);
});

test("the app can switch plugin styles off while it shows something they must not hide", async () => {
  const { dom, start, call, host } = setup(["editor.style"]);
  const frame = start("look");
  assert.equal((await call(frame, "editor.setStyle", ".live-editor { --bg: #fff }")).ok, true);
  const style = dom.head.children.find((c: any) => c.tag === "style");
  assert.equal(style.attrs.media, "all");
  host.pauseStyles(true);
  assert.equal(style.attrs.media, "not all");
  // A style set while paused stays off until the app resumes them.
  await call(frame, "editor.setStyle", ".live-editor { --bg: #000 }");
  assert.equal(style.attrs.media, "not all");
  host.pauseStyles(false);
  assert.equal(style.attrs.media, "all");
});
