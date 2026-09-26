import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { parseManifest } from "../../../../packages/plugins/src/manifest.ts";

const code = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const manifest = parseManifest(JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")));

/** Run the built main.js against a stand-in `granite` and see what it registers. */
function load() {
  const commands: { id: string; name: string; page?: boolean; run: () => unknown }[] = [];
  const items: { id: string; name: string; insert: () => Promise<string> }[] = [];
  const blocks: Record<string, unknown> = {};
  const buttons: { title: string; icon: string; open: unknown }[] = [];
  const notices: string[] = [];
  const vault = new Map<string, string>();
  const granite = {
    commands: { add: (c: (typeof commands)[number]) => void commands.push(c) },
    input: { addItem: async (i: (typeof items)[number]) => void items.push(i) },
    blocks: { register: (lang: string, fn: unknown) => void (blocks[lang] = fn) },
    editor: { getText: async () => "" },
    ui: { headerButton: (b: (typeof buttons)[number]) => void buttons.push(b), setBadge: async () => {}, copy: async () => {} },
    vault: {
      read: async (p: string) => {
        if (!vault.has(p)) throw new Error("no such note");
        return vault.get(p)!;
      },
      write: async (p: string, t: string) => void vault.set(p, t),
    },
    notice: (m: string) => notices.push(m),
  };
  vm.runInNewContext(code, { granite, console, setTimeout, clearTimeout, setInterval, clearInterval, crypto, TextEncoder, TextDecoder, URL, queueMicrotask, Uint8Array });
  return { commands, items, blocks, buttons, notices, vault };
}

test("the plugin asks for what it uses and needs API 7", () => {
  assert.equal(manifest.id, "live-collab");
  assert.ok((manifest.minApiVersion ?? 0) >= 7);
  for (const p of ["editor.sync", "editor.read", "editor.write", "editor.blocks", "editor.input", "ui.panel", "vault.read", "vault.write", "network"]) assert.ok(manifest.permissions.includes(p as never), p);
});

test("the built main.js loads and registers its commands, its // entry and its block", () => {
  const { commands, items, blocks, buttons } = load();
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]!.title, "Share");
  assert.match(buttons[0]!.icon, /^<svg/);
  assert.deepEqual(commands.map((c) => c.id).sort(), ["go-live", "leave"]);
  assert.ok(commands.every((c) => c.page));
  assert.equal(items.length, 1);
  assert.equal(items[0]!.name, "Live session");
  assert.ok(typeof blocks["collab"] === "function");
});

test("the // entry makes an invite, and on first use leaves a settings note to fill in", async () => {
  const { items, vault, notices } = load();
  const text = await items[0]!.insert();
  assert.match(text, /^```collab\nserver: wss:\/\/your-server\.example\.com\nroom: [a-z0-9]{32}\n```$/);
  assert.match(vault.get("Live Collab.md") ?? "", /name:/);
  assert.equal(notices.length, 1);
  vault.set("Live Collab.md", "name: Fais\nserver: wss://c.example.com");
  assert.match(await items[0]!.insert(), /server: wss:\/\/c\.example\.com\n/);
});
