import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { ChangeSet, Text } from "@codemirror/state";
import { WebSocket } from "ws";
import { SyncClient, type SyncEvent } from "../../../../packages/live-editor/src/syncClient.ts";
import { newInvite } from "../src/invite.ts";

// The real main.js and the real relay server, with two stand-in apps: each has an editor that speaks plugin API 6 the way LiveEditor does
// (`SyncClient`, one edit in flight), and a vault. Only the browser is missing (it was checked separately, against the real editor).

const code = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const PORT = 41000 + Math.floor(Math.random() * 1000);
const SERVER = `ws://localhost:${PORT}`;
const ROOM = "abcdefghijklmnopqrstuvwxyz012345";
let relay: ChildProcess;

before(async () => {
  relay = spawn("node", [new URL("../server/server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve) => relay.stdout!.on("data", () => resolve()));
});
after(() => relay.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

class App {
  doc: Text;
  vault = new Map<string, string>();
  notices: string[] = [];
  cursors: { name: string; anchor: number; head: number }[] = [];
  #client: SyncClient | null = null;
  #listener: ((e: SyncEvent) => void) | null = null;
  #commands = new Map<string, () => unknown>();
  events: SyncEvent[] = [];

  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
    const granite = {
      commands: { add: (c: { id: string; run: () => unknown }) => void this.#commands.set(c.id, c.run) },
      input: { addItem: async () => {} },
      blocks: { register: () => {} },
      notice: (m: string) => this.notices.push(m),
      vault: {
        read: async (p: string) => {
          if (!this.vault.has(p)) throw new Error("no such note");
          return this.vault.get(p)!;
        },
        write: async (p: string, t: string) => void this.vault.set(p, t),
      },
      editor: {
        getText: async () => this.doc.toString(),
        sync: {
          start: async (listener: (e: SyncEvent) => void) => {
            this.#listener = listener;
            this.#client = new SyncClient((e) => (this.events.push(e), listener(e)));
            return { text: this.doc.toString() };
          },
          stop: async () => void (this.#client = null),
          remote: async (json: unknown) => void (this.doc = this.#client!.remote(ChangeSet.fromJSON(json)).apply(this.doc)),
          ack: async () => void this.#client!.ack(),
          setCursors: async (list: { name: string; anchor: number; head: number }[]) => void (this.cursors = list),
        },
      },
    };
    vm.runInNewContext(code, {
      granite, console, setTimeout, clearTimeout, setInterval, clearInterval, crypto, TextEncoder, TextDecoder, URL, queueMicrotask, Uint8Array,
      WebSocket, navigator: {}, location: { href: "" }, Math, Date,
      requestAnimationFrame: () => 0, document: {}, ResizeObserver: class { observe() {} disconnect() {} },
    });
  }
  run(id: string) {
    return this.#commands.get(id)!();
  }
  get live() {
    return this.#client !== null;
  }
  /** The user types `text` at `at`. */
  type(at: number, text: string) {
    const c = ChangeSet.of({ from: at, insert: text }, this.doc.length);
    this.doc = c.apply(this.doc);
    this.#client!.local(c);
  }
  text() {
    return this.doc.toString();
  }
}

const invite = newInvite(SERVER, ROOM);

test("a second person joins, sees the first person's text, and both can type at once", async () => {
  const a = new App(`Plan the trip\n\n${invite}\n`);
  const b = new App(`${invite}\n`);
  await a.run("go-live");
  assert.ok(a.live);
  await b.run("go-live");
  await until(() => b.text() === a.text(), "B to receive A's text");
  assert.match(b.text(), /^Plan the trip/);
  assert.ok(b.notices.some((n) => /joined as/.test(n)), b.notices.join(" | "));
  await until(() => a.notices.some((n) => /joined/.test(n) && !/as/.test(n)), "A to hear that B joined");

  // both type at the same moment, at different places
  a.type(0, "AAA ");
  b.type(b.doc.length, "BBB");
  await until(() => a.text() === b.text() && a.text().includes("AAA ") && a.text().includes("BBB"), "both edits to reach both");
  assert.ok(a.text().startsWith("AAA Plan the trip"));
  assert.ok(a.text().endsWith("BBB"));

  // typing in the same spot at the same moment still ends up identical
  a.type(4, "1");
  b.type(4, "2");
  await until(() => a.text() === b.text() && /[12]{2}/.test(a.text().slice(4, 6)), "the same-spot edits to settle");
  assert.equal(a.text(), b.text());
});

test("a note with only the invite can't start a room nobody has begun", async () => {
  const room = "zyxwvutsrqponmlkjihgfedcba987654";
  const lonely = new App(`${newInvite(SERVER, room)}\n`);
  await lonely.run("go-live");
  assert.ok(!lonely.live);
  assert.ok(lonely.notices.some((n) => /hasn't gone live yet/.test(n)), lonely.notices.join(" | "));
});

test("joining with a note that has other text keeps that text in a backup copy first", async () => {
  const room = "qwertyuiopasdfghjklzxcvbnm123456";
  const host = new App(`Host text\n${newInvite(SERVER, room)}\n`);
  await host.run("go-live");
  const guest = new App(`My own notes, not for sharing\n${newInvite(SERVER, room)}\n`);
  await guest.run("go-live");
  await until(() => guest.text() === host.text(), "the guest to take the room's text");
  const backups = [...guest.vault].filter(([p]) => p.startsWith("Live Collab backup "));
  assert.equal(backups.length, 1);
  assert.match(backups[0]![1], /My own notes, not for sharing/);
});

test("a room id that isn't 32 letters and digits is refused by the server", async () => {
  const ws = new WebSocket(`${SERVER}/short`);
  const result = await new Promise<string>((resolve) => {
    ws.on("error", () => resolve("refused"));
    ws.on("unexpected-response", () => resolve("refused"));
    ws.on("open", () => resolve("open"));
  });
  assert.equal(result, "refused");
});
