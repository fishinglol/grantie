import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { ChangeSet, Text } from "@codemirror/state";
import { WebSocket } from "ws";
import { SyncClient, type SyncEvent } from "../../../../packages/live-editor/src/syncClient.ts";
import { newInvite, parseInvite } from "../src/invite.ts";
import { roomName } from "../src/relay.ts";
import { El, button, fakeDocument, hasButton, input } from "./fakeDom.ts";

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

type PluginButton = { title: string; icon: string; open: (el: El, ctx: { close(): void; resize(h: number): void }) => { close?(): void } | void };

class App {
  doc: Text;
  vault = new Map<string, string>();
  notices: string[] = [];
  cursors: { name: string; anchor: number; head: number }[] = [];
  #client: SyncClient | null = null;
  #listener: ((e: SyncEvent) => void) | null = null;
  #commands = new Map<string, () => unknown>();
  events: SyncEvent[] = [];
  copied: string[] = [];
  badge: string | null = null;
  /** The Share window: `body` is what the plugin draws into; null while it is closed. */
  panel: El | null = null;
  #button: PluginButton | null = null;
  #onClose: (() => void) | null = null;

  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
    const granite = {
      commands: { add: (c: { id: string; run: () => unknown }) => void this.#commands.set(c.id, c.run) },
      input: { addItem: async () => {} },
      blocks: { register: () => {} },
      ui: {
        headerButton: (b: PluginButton) => void (this.#button = b),
        setBadge: async (c: string | null) => void (this.badge = c),
        copy: async (t: string) => void this.copied.push(t),
      },
      notice: (m: string) => this.notices.push(m),
      vault: {
        read: async (p: string) => {
          if (!this.vault.has(p)) throw new Error("no such note");
          return this.vault.get(p)!;
        },
        write: async (p: string, t: string) => void this.vault.set(p, t),
        list: async () => [...this.vault.keys()],
        // opening a note shows it in the editor (this stand-in app has one editor)
        open: async (p: string) => void (this.doc = Text.of((this.vault.get(p) ?? "").split("\n"))),
      },
      editor: {
        getText: async () => this.doc.toString(),
        setText: async (t: string) => void (this.doc = Text.of(t.split("\n"))),
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
      requestAnimationFrame: () => 0, document: fakeDocument(), HTMLInputElement: El, ResizeObserver: class { observe() {} disconnect() {} },
    });
  }
  /** Press the Share button at the top of the note. */
  openPanel() {
    this.panel = new El("body");
    const handle = this.#button!.open(this.panel, { close: () => this.closePanel(), resize: () => {} });
    this.#onClose = (handle && handle.close) || null;
  }
  closePanel() {
    this.#onClose?.();
    this.panel = null;
  }
  press(text: string) {
    button(this.panel!, text).fire("click");
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

// ---- the Share window ---------------------------------------------------------------------------------------------------------------

const settingsNote = (name: string, server = SERVER) => `name: ${name}\nserver: ${server}\n`;
const panelText = (app: App) => app.panel!.textContent;

test("Share: start sharing puts an invite in the note and goes live; Copy gives an invite a friend can use", async () => {
  const ann = new App("Plan the trip\n");
  ann.vault.set("Live Collab.md", settingsNote("Ann"));
  ann.openPanel();
  await until(() => panelText(ann).includes("Start sharing"), "the window to draw");
  ann.press("Start sharing");
  await until(() => ann.live && panelText(ann).includes("Invite link"), "Ann to go live");
  const invite = parseInvite(ann.text());
  assert.equal(invite?.server, SERVER);
  assert.ok(ann.text().endsWith("Plan the trip\n"), "her own text is still there, after the invite");
  assert.equal(ann.badge, "#30a46c");
  assert.match(panelText(ann), /Ann.*You/);

  ann.press("Copy link");
  await until(() => ann.copied.length === 1, "the invite to be copied");
  assert.deepEqual(parseInvite(ann.copied[0]!), invite, "a plain ws server is shared as the whole block");

  // A friend with an empty note and no server of their own pastes it and joins.
  const bo = new App("");
  bo.vault.set("Live Collab.md", "name: Bo\n");
  bo.openPanel();
  await until(() => panelText(bo).includes("Join"), "Bo's window");
  const box = input(bo.panel!, "join");
  box.value = ann.copied[0]!;
  bo.press("Join");
  await until(() => bo.live && bo.text() === ann.text(), "Bo to join and get Ann's note");
  const path = `Shared note ${invite!.room.slice(-6)}.md`;
  assert.ok(bo.vault.has(path), "the joined note is a new note in Bo's vault");
  await until(() => /Ann/.test(panelText(bo)) && /Bo/.test(panelText(bo)), "Bo to see who is here");
  await until(() => /Bo/.test(panelText(ann)), "Ann to see Bo in her list");
  ann.press("Leave the live session");
  assert.ok(!ann.live);
  assert.equal(ann.badge, null);
  assert.ok(hasButton(ann.panel!, "Start sharing"), "the window goes back to the start");
  bo.press("Leave the live session");
});

test("Share: an empty note can't be shared, and without a server the window asks for one first", async () => {
  const empty = new App("\n");
  empty.vault.set("Live Collab.md", settingsNote("Cy"));
  empty.openPanel();
  await until(() => empty.panel!.textContent.includes("empty note"), "the hint");
  assert.ok(button(empty.panel!, "Start sharing").disabled);

  const app = new App("Some text\n");
  app.openPanel();
  await until(() => panelText(app).includes("Start sharing"), "the window to draw");
  app.press("Start sharing");
  await until(() => panelText(app).includes("Server address"), "the settings to open");
  assert.ok(!app.live);
  input(app.panel!, "set-name").value = "Dee";
  input(app.panel!, "set-server").value = `localhost:${PORT}`;
  app.press("Save");
  await until(() => /server: wss:\/\/localhost/.test(app.vault.get("Live Collab.md") ?? ""), "the settings note to be written");
  assert.match(app.vault.get("Live Collab.md")!, /name: Dee/);
});

test("Share: a link that isn't an invite says so, and nothing is created", async () => {
  const app = new App("");
  app.openPanel();
  await until(() => panelText(app).includes("Join"), "the window to draw");
  input(app.panel!, "join").value = "https://example.com/not-an-invite";
  app.press("Join");
  await until(() => panelText(app).includes("not an invite link"), "the message");
  assert.equal(app.vault.size, 0);
});

test("the relay only ever holds unreadable data: the note's words never reach it", async () => {
  const room = "relayblindtestroom0123456789abcd";
  const host = new App(`A very SECRETWORD note\n${newInvite(SERVER, room)}\n`);
  await host.run("go-live");
  host.type(0, "MORESECRET ");
  await sleep(300);
  // Pose as a newcomer at the relay: it replays everything it kept.
  const ws = new WebSocket(`${SERVER}/${await roomName(room)}`);
  ws.binaryType = "arraybuffer";
  const seen: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data: ArrayBuffer) => {
      const bytes = new Uint8Array(data);
      seen.push(bytes);
      if (bytes[0] === 3) resolve();
    });
    ws.on("error", reject);
  });
  ws.close();
  const kept = seen.filter((b) => b[0] === 1);
  assert.ok(kept.length >= 2, "it kept the edits");
  const all = Buffer.concat(kept).toString("latin1");
  for (const word of ["SECRETWORD", "MORESECRET", "note"]) assert.ok(!all.includes(word), `"${word}" is not in what the relay holds`);
});

test("a joiner with a different secret lands in a different (empty) room, and a note that is only an invite can't start it", async () => {
  const host = new App(`Hello there\n${newInvite(SERVER, "sameserverdifferentsecret1234567")}\n`);
  await host.run("go-live");
  const stranger = new App(`${newInvite(SERVER, "sameserverdifferentsecret1234568")}\n`);
  await stranger.run("go-live");
  assert.ok(!stranger.live);
  assert.ok(stranger.notices.some((n) => /hasn't gone live yet/.test(n)));
});
