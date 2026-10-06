import assert from "node:assert/strict";
import { test } from "node:test";
import { METHOD_PERMISSION } from "../src/api.ts";
import { PluginHost, type HostAdapter } from "../src/host.ts";
import { NO_ICONS, globMatch, mergeIconConfigs, parseIconConfig, resolveIcon } from "../src/icons.ts";
import { API_VERSION, PERMISSIONS, parseManifest } from "../src/manifest.ts";

const SVG = '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';

test("API 9 has the ui.icons permission, and setIcons needs it", () => {
  assert.ok(API_VERSION >= 9);
  assert.ok((PERMISSIONS as readonly string[]).includes("ui.icons"));
  assert.equal(METHOD_PERMISSION["ui.icons"], "ui.icons");
});

test("icons are an emoji or a plain svg, with an optional colour", () => {
  const c = parseIconConfig({
    defaults: { folder: "📁", folderOpen: { emoji: "📂" }, note: { svg: SVG, color: "#E8935F" } },
    rules: [{ match: "Fais OS/**", icon: "🧠" }],
  });
  assert.equal(c.defaults.folder!.emoji, "📁");
  assert.equal(c.defaults.folderOpen!.emoji, "📂");
  assert.equal(c.defaults.note!.color, "#e8935f");
  assert.ok(c.defaults.note!.svg!.includes('xmlns="http://www.w3.org/2000/svg"'), "the namespace is added, so the icon draws as an image");
  assert.deepEqual(c.rules, [{ match: "Fais OS/**", icon: { emoji: "🧠" } }]);
  assert.deepEqual(parseIconConfig(null), { defaults: {}, rules: [] });
  assert.deepEqual(NO_ICONS.rules, []);
});

test("anything unsafe or malformed is refused", () => {
  const bad = (v: unknown) => assert.throws(() => parseIconConfig(v), (e: unknown) => e instanceof Error, JSON.stringify(v)?.slice(0, 80));
  bad("x");
  bad({ defaults: { folder: "" } });
  bad({ defaults: { folder: "a".repeat(17) } });
  bad({ defaults: { folder: "<b>" } });
  bad({ defaults: { folder: { emoji: "📁", svg: SVG } } }); // both
  bad({ defaults: { folder: {} } }); // neither
  bad({ defaults: { folder: '<svg><script>alert(1)</script></svg>' } });
  bad({ defaults: { folder: '<svg><image href="https://x"/></svg>' } });
  bad({ defaults: { folder: '<svg><style>*{}</style></svg>' } });
  bad({ defaults: { folder: { emoji: "📁", color: "red" } } });
  bad({ defaults: { folders: "📁" } }); // a name that isn't one
  bad({ rules: "x" });
  bad({ rules: [{ icon: "📁" }] }); // no match
  bad({ rules: [{ match: "/abs", icon: "📁" }] });
  bad({ rules: [{ match: "a", kind: "page", icon: "📁" }] });
  bad({ rules: Array.from({ length: 301 }, (_, i) => ({ match: `n${i}`, icon: "📁" })) });
  bad({ rules: Array.from({ length: 60 }, (_, i) => ({ match: `n${i}`, icon: { svg: `<svg>${"<path d=\"M0 0\"/>".repeat(150)}</svg>` } })) }); // too much in all
});

test("patterns: * inside a name, ** across folders, everything else literal", () => {
  assert.ok(globMatch("Fais OS", "Fais OS"));
  assert.ok(!globMatch("Fais OS", "Fais OS/x.md"));
  assert.ok(globMatch("Fais OS/**", "Fais OS/Keep in mind.md"));
  assert.ok(globMatch("Fais OS/**", "Fais OS/my own schedule/Main.md"));
  assert.ok(!globMatch("Fais OS/**", "Fais OS"), "the folder itself is not 'inside' it");
  assert.ok(!globMatch("Fais OS/**", "Fais OS 2/x.md"));
  assert.ok(globMatch("*.canvas", "board.canvas"));
  assert.ok(!globMatch("*.canvas", "a/board.canvas"), "* does not cross folders");
  assert.ok(globMatch("**/*.canvas", "a/b/board.canvas"));
  assert.ok(globMatch("Journal/2026-*", "Journal/2026-10-01.md"));
  assert.ok(globMatch("a.b (1)+[x]", "a.b (1)+[x]"), "characters that mean something in a regex are literal");
  assert.ok(!globMatch("a.b", "aXb"));
  assert.ok(!globMatch("fais os", "Fais OS"), "case matters");
});

test("a rule beats a default, the first matching rule wins, and a kind filter applies", () => {
  const c = parseIconConfig({
    defaults: { folder: "📁", folderOpen: "📂", note: "📝", canvas: "🎨" },
    rules: [
      { match: "Fais OS", kind: "folder", icon: "🧠" },
      { match: "Fais OS/**", icon: "💡" },
      { match: "Fais OS/**", icon: "❌" },
      { match: "**", kind: "canvas", icon: "🖼" },
    ],
  });
  const emoji = (q: Parameters<typeof resolveIcon>[1]) => resolveIcon(c, q)?.emoji;
  assert.equal(emoji({ kind: "folder", path: "Fais OS" }), "🧠");
  assert.equal(emoji({ kind: "folder", path: "Fais OS", open: true }), "🧠", "a rule covers both states of a folder");
  assert.equal(emoji({ kind: "note", path: "Fais OS/Evaluation.md" }), "💡");
  assert.equal(emoji({ kind: "canvas", path: "Fais OS/board.canvas" }), "💡", "an earlier rule wins over a later one");
  assert.equal(emoji({ kind: "canvas", path: "x.canvas" }), "🖼");
  assert.equal(emoji({ kind: "note", path: "Colony/a.md" }), "📝");
  assert.equal(emoji({ kind: "folder", path: "Colony" }), "📁");
  assert.equal(emoji({ kind: "folder", path: "Colony", open: true }), "📂");
  assert.equal(resolveIcon(NO_ICONS, { kind: "note", path: "a.md" }), null, "nothing set: the app draws its own");
  assert.equal(resolveIcon(parseIconConfig({ defaults: { folder: "📁" } }), { kind: "folder", path: "a", open: true })?.emoji, "📁", "folderOpen falls back to folder");
});

test("an app that can't draw svg skips those icons and tries the next one", () => {
  const c = parseIconConfig({ defaults: { note: "📝" }, rules: [{ match: "a/**", icon: { svg: SVG } }, { match: "a/**", icon: "🅰" }] });
  assert.ok(resolveIcon(c, { kind: "note", path: "a/x.md" })!.svg);
  assert.equal(resolveIcon(c, { kind: "note", path: "a/x.md" }, { svg: false })!.emoji, "🅰");
  const only = parseIconConfig({ rules: [{ match: "a/**", icon: { svg: SVG } }] });
  assert.equal(resolveIcon(only, { kind: "note", path: "a/x.md" }, { svg: false }), null);
});

test("several plugins: rules keep their order, and the first plugin to set a default keeps it", () => {
  const a = parseIconConfig({ defaults: { folder: "🅰" }, rules: [{ match: "x", icon: "1" }] });
  const b = parseIconConfig({ defaults: { folder: "🅱", note: "n" }, rules: [{ match: "x", icon: "2" }] });
  const m = mergeIconConfigs([a, b]);
  assert.equal(m.defaults.folder!.emoji, "🅰");
  assert.equal(m.defaults.note!.emoji, "n");
  assert.deepEqual(m.rules.map((r) => r.icon.emoji), ["1", "2"]);
});

// ---- the host ----
type Listener = (event: { data: unknown; source: unknown }) => void;
function setup() {
  const listeners: Listener[] = [];
  const frames: any[] = [];
  const el = (tag: string) => ({
    tag, className: "", style: {} as Record<string, string>, attrs: {} as Record<string, string>,
    setAttribute() {}, addEventListener() {}, remove() {},
    contentWindow: tag === "iframe" ? { posted: [] as any[], postMessage(m: unknown) { this.posted.push(m); } } : undefined,
  });
  const head = { children: [] as any[], querySelector: () => null, querySelectorAll: () => [], append(e: any) { this.children.push(e); } };
  (globalThis as any).window = { addEventListener: (_: string, l: Listener) => listeners.push(l), removeEventListener() {}, innerHeight: 800 };
  (globalThis as any).getComputedStyle = () => ({ getPropertyValue: () => "", colorScheme: "dark" });
  (globalThis as any).document = { body: { append() {} }, head, documentElement: {}, querySelector: () => null, createElement: (t: string) => { const e = el(t); if (t === "iframe") frames.push(e); return e; } };
  const from = (frame: any, data: unknown) => listeners.forEach((l) => l({ data, source: frame.contentWindow }));
  let changes = 0;
  const host = new PluginHost({ notice() {} } as unknown as HostAdapter, undefined, undefined, undefined, () => changes++);
  const start = (id: string, permissions: string[] = ["ui.icons"]) => {
    void host.load(parseManifest({ id, name: id, version: "1", permissions }), "");
    const frame = frames[frames.length - 1]!;
    from(frame, { k: "boot" });
    from(frame, { k: "ready" });
    return frame;
  };
  const call = async (frame: any, method: string, ...args: unknown[]) => {
    const n = 1 + frame.contentWindow.posted.length;
    from(frame, { k: "call", n, method, args });
    await new Promise((r) => setTimeout(r, 0));
    return [...frame.contentWindow.posted].reverse().find((m: any) => m.k === "result" && m.n === n) as { ok: boolean; error?: string };
  };
  return { host, start, call, changes: () => changes };
}

test("a plugin without ui.icons can't set icons", async () => {
  const { host, start, call } = setup();
  const r = await call(start("p", []), "ui.icons", { defaults: { folder: "📁" } });
  assert.equal(r.ok, false);
  assert.match(r.error!, /ui\.icons/);
  assert.deepEqual(host.iconConfig(), NO_ICONS);
});

test("icons are listed, the apps are told, a bad one is refused, and they go with the plugin", async () => {
  const { host, start, call, changes } = setup();
  const frame = start("zeta");
  assert.equal((await call(frame, "ui.icons", { defaults: { folder: "📁" } })).ok, true);
  assert.equal(host.iconConfig().defaults.folder!.emoji, "📁");
  assert.ok(changes() >= 1);
  assert.equal((await call(frame, "ui.icons", { defaults: { folder: "<b>" } })).ok, false);
  assert.equal(host.iconConfig().defaults.folder!.emoji, "📁", "a refused call leaves what was set");
  assert.equal((await call(frame, "ui.icons", { rules: [{ match: "a", icon: "🅰" }] })).ok, true);
  assert.equal(host.iconConfig().defaults.folder, undefined, "calling again replaces what the plugin set");
  const before = changes();
  host.unload("zeta");
  assert.deepEqual(host.iconConfig().rules, []);
  assert.ok(changes() > before, "the apps are told when the plugin goes");
});

test("two plugins: the one with the lower id wins a default", async () => {
  const { host, start, call } = setup();
  const b = start("b");
  const a = start("a");
  await call(b, "ui.icons", { defaults: { note: "B" }, rules: [{ match: "x", icon: "b" }] });
  await call(a, "ui.icons", { defaults: { note: "A" }, rules: [{ match: "x", icon: "a" }] });
  assert.equal(host.iconConfig().defaults.note!.emoji, "A");
  assert.deepEqual(host.iconConfig().rules.map((r) => r.icon.emoji), ["a", "b"]);
});
