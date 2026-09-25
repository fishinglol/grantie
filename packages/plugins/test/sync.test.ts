import assert from "node:assert/strict";
import { test } from "node:test";
import { METHOD_PERMISSION } from "../src/api.ts";
import { PluginHost, checkCursors, type HostAdapter, type SyncPort } from "../src/host.ts";
import { API_VERSION, PERMISSIONS, parseManifest } from "../src/manifest.ts";

// A stand-in for the browser bits the host touches: one fake frame per plugin that records what the host posts to it.
type Listener = (event: { data: unknown; source: unknown }) => void;
function fakeDom() {
  const listeners: Listener[] = [];
  const frames: { contentWindow: { posted: any[]; postMessage(m: unknown): void }; remove(): void }[] = [];
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {} };
  (globalThis as any).document = {
    body: { append() {} },
    head: { querySelector: () => null, append() {} },
    createElement: () => {
      const frame = {
        contentWindow: { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } },
        setAttribute() {},
        style: {} as Record<string, string>,
        remove() {},
      };
      frames.push(frame);
      return frame;
    },
  };
  return { frames, from: (frame: (typeof frames)[number], data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow })) };
}

function fakePort() {
  const log: string[] = [];
  let listener: ((e: any) => void) | null = null;
  const port: SyncPort = {
    start: (l) => {
      listener?.({ type: "ended", reason: "another live session started" }); // like the editor does
      listener = l;
      log.push("start");
      return "hello";
    },
    stop: () => void log.push("stop"),
    remote: (c) => void log.push(`remote ${JSON.stringify(c)}`),
    ack: () => void log.push("ack"),
    setCursors: (c) => void log.push(`cursors ${c.length}`),
  };
  return { port, log, emit: (e: unknown) => listener?.(e) };
}

function setup(permissions: string[] = ["editor.sync"], withPort = true) {
  const dom = fakeDom();
  const { port, log, emit } = fakePort();
  const notices: string[] = [];
  const adapter = { notice: (m: string) => notices.push(m), ...(withPort && { sync: port }) } as unknown as HostAdapter;
  const host = new PluginHost(adapter);
  const start = (id: string, perms = permissions) => {
    void host.load(parseManifest({ id, name: id, version: "1", permissions: perms }), "");
    const frame = dom.frames[dom.frames.length - 1]!;
    dom.from(frame, { k: "boot" });
    dom.from(frame, { k: "ready" });
    return frame;
  };
  /** Make a call as the plugin would and return its reply. */
  const call = async (frame: ReturnType<typeof start>, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    dom.from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
    return frame.contentWindow.posted.findLast((m) => m.k === "result" && m.n === n) as { ok: boolean; value?: any; error?: string };
  };
  return { host, dom, log, emit, notices, start, call };
}

test("API 6 has the editor.sync permission and every sync method needs it", () => {
  assert.ok(API_VERSION >= 6);
  assert.ok((PERMISSIONS as readonly string[]).includes("editor.sync"));
  for (const m of ["sync.start", "sync.stop", "sync.remote", "sync.ack", "sync.setCursors"]) assert.equal(METHOD_PERMISSION[m], "editor.sync");
});

test("a plugin without the permission can't start a live session", async () => {
  const t = setup([]);
  const r = await t.call(t.start("nope", []), "sync.start");
  assert.equal(r.ok, false);
  assert.match(r.error!, /editor\.sync/);
  assert.deepEqual(t.log, []);
});

test("starting gives the plugin the note's text, and the note's events reach the plugin's frame", async () => {
  const t = setup();
  const frame = t.start("collab");
  const r = await t.call(frame, "sync.start");
  assert.deepEqual(r.value, { text: "hello" });
  t.emit({ type: "change", base: 0, changes: [[0, "x"]] });
  assert.deepEqual(frame.contentWindow.posted.at(-1), { k: "sync", event: { type: "change", base: 0, changes: [[0, "x"]] } });
});

test("remote edits, acks and carets go to the note, and only from the plugin in the session", async () => {
  const t = setup();
  const a = t.start("a");
  const b = t.start("b");
  assert.equal((await t.call(b, "sync.remote", [1])).ok, false, "not in a session yet");
  await t.call(a, "sync.start");
  assert.equal((await t.call(a, "sync.remote", [[0, "x"]])).ok, true);
  assert.equal((await t.call(a, "sync.ack")).ok, true);
  assert.equal((await t.call(a, "sync.setCursors", [{ id: "1", name: "Ann", color: "#aabbcc", anchor: 0, head: 3 }])).ok, true);
  assert.deepEqual(t.log, ["start", 'remote [[0,"x"]]', "ack", "cursors 1"]);
  const other = await t.call(b, "sync.start");
  assert.match(other.error!, /another plugin/);
  assert.equal((await t.call(b, "sync.ack")).ok, false);
});

test("the session is over when the note says so, when the plugin stops it, and when the plugin is unloaded", async () => {
  const t = setup();
  const frame = t.start("collab");
  await t.call(frame, "sync.start");
  t.emit({ type: "ended", reason: "another note was opened" });
  assert.equal(frame.contentWindow.posted.at(-1).event.type, "ended");
  assert.equal((await t.call(frame, "sync.ack")).ok, false, "nothing to ack after the end");

  await t.call(frame, "sync.start");
  await t.call(frame, "sync.stop");
  assert.equal(t.log.at(-1), "stop");
  assert.equal((await t.call(frame, "sync.ack")).ok, false);

  await t.call(frame, "sync.start");
  t.host.unload("collab");
  assert.equal(t.log.at(-1), "stop", "unloading the plugin releases the note");
});

test("a plugin restarting its own session is not ended by the old one's goodbye", async () => {
  const t = setup();
  const frame = t.start("collab");
  await t.call(frame, "sync.start");
  await t.call(frame, "sync.start");
  assert.equal((await t.call(frame, "sync.ack")).ok, true);
});

test("an app without live sessions says so", async () => {
  const t = setup(["editor.sync"], false);
  const r = await t.call(t.start("collab"), "sync.start");
  assert.match(r.error!, /cannot do live sessions/);
});

test("carets are checked: they end up in the editor's CSS and DOM", () => {
  const ok = { id: "a", name: "Ann", color: "#A1b2C3", anchor: 0, head: 4 };
  assert.deepEqual(checkCursors([ok]), [ok]);
  assert.deepEqual(checkCursors([]), []);
  for (const bad of [
    { ...ok, color: "red" },
    { ...ok, color: "#fff" },
    { ...ok, color: "#aabbcc;background:url(x)" },
    { ...ok, name: "x".repeat(41) },
    { ...ok, id: "" },
    { ...ok, anchor: -1 },
    { ...ok, head: 1.5 },
    null,
  ]) assert.throws(() => checkCursors([bad]), Error, JSON.stringify(bad));
  assert.throws(() => checkCursors("no"), /list/);
  assert.throws(() => checkCursors(Array.from({ length: 51 }, () => ok)), /up to 50/);
});
