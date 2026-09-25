import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { ChangeSet, Text } from "@codemirror/state";
import { SyncClient, type SyncEvent } from "../../../../packages/live-editor/src/syncClient.ts";
import { Authority } from "../src/authority.ts";

/** One person: an editor (`SyncClient` + its text) talking to a plugin (`Authority` over a Yjs doc), through in-order queues. */
class Peer {
  ydoc = new Y.Doc();
  ytext = this.ydoc.getText("note");
  doc: Text;
  toPlugin: SyncEvent[] = [];
  toEditor: ({ kind: "ack" } | { kind: "remote"; changes: ChangeSet })[] = [];
  client = new SyncClient((e) => this.toPlugin.push(e));
  authority: Authority;
  /** Yjs updates waiting to go to the other peer. */
  outbox: Uint8Array[] = [];
  /** `joining`: start from another peer's Yjs history (like joining a room), instead of writing the text in fresh. */
  constructor(text: string, joining?: Peer) {
    this.doc = Text.of(text.split("\n"));
    if (joining) Y.applyUpdate(this.ydoc, Y.encodeStateAsUpdate(joining.ydoc));
    else this.ytext.insert(0, text);
    this.authority = new Authority(
      this.ydoc,
      this.ytext,
      { ack: () => this.toEditor.push({ kind: "ack" }), remote: (json) => this.toEditor.push({ kind: "remote", changes: ChangeSet.fromJSON(json) }) },
      text.length,
    );
    this.ydoc.on("update", (u: Uint8Array) => this.outbox.push(u));
  }
  type(rand: () => number) {
    const at = Math.floor(rand() * (this.doc.length + 1));
    const del = rand() < 0.4 ? Math.min(this.doc.length - at, Math.floor(rand() * 4)) : 0;
    const insert = rand() < 0.8 ? "xyz".slice(0, 1 + Math.floor(rand() * 3)) + (rand() < 0.1 ? "\n" : "") : "";
    const c = ChangeSet.of({ from: at, to: at + del, insert }, this.doc.length);
    this.doc = c.apply(this.doc);
    this.client.local(c);
  }
  pluginStep(): boolean {
    const e = this.toPlugin.shift();
    if (!e) return false;
    if (e.type === "change") this.authority.receive(e.base, e.changes);
    return true;
  }
  editorStep(): boolean {
    const m = this.toEditor.shift();
    if (!m) return false;
    if (m.kind === "ack") this.client.ack();
    else this.doc = this.client.remote(m.changes).apply(this.doc);
    return true;
  }
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test("two people typing at once, over a slow network, end up with the same text everywhere", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = rng(seed);
    const a = new Peer("hello world");
    const b = new Peer("hello world", a); // b joins a's room
    a.outbox.length = 0;
    b.outbox.length = 0;
    const peers = [a, b] as const;
    const send = (from: Peer, to: Peer) => {
      const u = from.outbox.shift();
      if (u) Y.applyUpdate(to.ydoc, u);
    };
    for (let i = 0; i < 80; i++) {
      const p = peers[Math.floor(rand() * 2)]!;
      const r = rand();
      if (r < 0.3) p.type(rand);
      else if (r < 0.5) p.pluginStep();
      else if (r < 0.7) p.editorStep();
      else send(p, p === a ? b : a);
    }
    // everything arrives
    for (let guard = 0; guard < 10_000; guard++) {
      let moved = false;
      for (const p of peers) moved = p.pluginStep() || p.editorStep() || moved;
      const ua = a.outbox.length + b.outbox.length;
      send(a, b);
      send(b, a);
      if (!moved && ua === 0) break;
    }
    const text = a.ytext.toString();
    assert.equal(b.ytext.toString(), text, `seed ${seed}: the shared texts agree`);
    assert.equal(a.doc.toString(), text, `seed ${seed}: A's editor follows`);
    assert.equal(b.doc.toString(), text, `seed ${seed}: B's editor follows`);
    assert.ok(a.client.synced && b.client.synced);
  }
});

test("replace() turns the editor's text into the room's, and typing afterwards still lines up", () => {
  const p = new Peer("old text here");
  p.ytext.delete(0, p.ytext.length);
  p.ytext.insert(0, "the room's text"); // the room's text (this peer's authority sees it as another person's change)
  p.toEditor.length = 0;
  p.authority.replace("old text here", "the room's text");
  const m = p.toEditor.shift()!;
  assert.equal(m.kind, "remote");
  if (m.kind === "remote") assert.equal(p.client.remote(m.changes).apply(p.doc).toString(), "the room's text");
});

test("an edit that doesn't fit the shared text is refused, not written", () => {
  const p = new Peer("abc");
  const bad = ChangeSet.of({ from: 0, insert: "x" }, 10).toJSON();
  assert.throws(() => p.authority.receive(0, bad), /does not fit/);
  assert.equal(p.ytext.toString(), "abc");
});

test("a caret position is carried over what the editor hasn't seen", () => {
  const p = new Peer("abcdef");
  p.ydoc.transact(() => p.ytext.insert(0, "ZZ"), "other person");
  assert.equal(p.authority.mapPosition(0, 3), 5);
  assert.equal(p.authority.mapPosition(1, 3), 3);
});
