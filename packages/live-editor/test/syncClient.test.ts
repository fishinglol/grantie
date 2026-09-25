import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeSet, Text } from "@codemirror/state";
import { SyncClient, type SyncEvent } from "../src/syncClient.ts";

/** The other end, as a plugin writes it: an ordered log, and edits from the editor mapped over what it missed. */
class Authority {
  doc: Text;
  log: ChangeSet[] = [];
  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
  }
  /** An edit from the editor, based on log entry `base`. */
  receive(base: number, json: unknown): void {
    let changes = ChangeSet.fromJSON(json);
    for (const entry of this.log.slice(base)) changes = changes.map(entry);
    this.doc = changes.apply(this.doc);
    this.log.push(changes);
  }
  /** An edit made here (another user's). */
  edit(changes: ChangeSet): void {
    this.doc = changes.apply(this.doc);
    this.log.push(changes);
  }
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function randomChange(doc: Text, rand: () => number): ChangeSet {
  const at = Math.floor(rand() * (doc.length + 1));
  const del = rand() < 0.4 ? Math.min(doc.length - at, Math.floor(rand() * 4)) : 0;
  const insert = rand() < 0.8 ? "abcdef".slice(0, 1 + Math.floor(rand() * 3)) + (rand() < 0.1 ? "\n" : "") : "";
  return ChangeSet.of({ from: at, to: at + del, insert }, doc.length);
}

test("an editor and its authority end up with the same text, whatever the order things arrive in", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = rng(seed);
    const start = "hello world";
    const authority = new Authority(start);
    let editorDoc = Text.of([start]);
    const toAuthority: SyncEvent[] = [];
    type Down = { kind: "ack" } | { kind: "remote"; changes: ChangeSet };
    const toEditor: Down[] = [];
    const client = new SyncClient((e) => toAuthority.push(e));

    const step = () => {
      const r = rand();
      if (r < 0.35) {
        // the user types
        const c = randomChange(editorDoc, rand);
        editorDoc = c.apply(editorDoc);
        client.local(c);
      } else if (r < 0.55) {
        // another user types at the authority
        const c = randomChange(authority.doc, rand);
        authority.edit(c);
        toEditor.push({ kind: "remote", changes: c });
      } else if (r < 0.8 && toAuthority.length) {
        const e = toAuthority.shift()!;
        assert.equal(e.type, "change");
        if (e.type === "change") authority.receive(e.base, e.changes);
        toEditor.push({ kind: "ack" });
      } else if (toEditor.length) {
        const m = toEditor.shift()!;
        if (m.kind === "ack") client.ack();
        else editorDoc = client.remote(m.changes).apply(editorDoc);
      }
    };
    for (let i = 0; i < 60; i++) step();
    // let everything arrive
    while (toAuthority.length || toEditor.length) {
      if (toAuthority.length) {
        const e = toAuthority.shift()!;
        if (e.type === "change") authority.receive(e.base, e.changes);
        toEditor.push({ kind: "ack" });
      }
      const m = toEditor.shift();
      if (m?.kind === "ack") client.ack();
      else if (m) editorDoc = client.remote(m.changes).apply(editorDoc);
    }
    assert.equal(editorDoc.toString(), authority.doc.toString(), `seed ${seed}`);
    assert.equal(client.synced, true);
    assert.equal(client.base, authority.log.length, `seed ${seed}: the editor took in every log entry`);
  }
});

test("only one edit is in flight at a time; later typing waits and goes out as one", () => {
  const sent: SyncEvent[] = [];
  const client = new SyncClient((e) => sent.push(e));
  const doc0 = Text.of(["ab"]);
  const c1 = ChangeSet.of({ from: 2, insert: "c" }, 2);
  const c2 = ChangeSet.of({ from: 3, insert: "d" }, 3);
  const c3 = ChangeSet.of({ from: 4, insert: "e" }, 4);
  client.local(c1);
  client.local(c2);
  client.local(c3);
  assert.equal(sent.length, 1);
  assert.equal(client.synced, false);
  client.ack();
  assert.equal(sent.length, 2);
  const second = sent[1]!;
  assert.equal(second.type === "change" && second.base, 1);
  assert.equal(second.type === "change" && ChangeSet.fromJSON(second.changes).apply(Text.of(["abc"])).toString(), "abcde");
  client.ack();
  assert.equal(client.synced, true);
  assert.equal(doc0.toString(), "ab");
});

test("a position from the authority is carried over what the user typed since", () => {
  const client = new SyncClient(() => {});
  client.local(ChangeSet.of({ from: 0, insert: "xyz" }, 10));
  assert.equal(client.toLocal(4), 7);
  client.ack();
  assert.equal(client.toLocal(4), 4);
});

test("an acknowledgement nobody is waiting for is a bug, not silently ignored", () => {
  assert.throws(() => new SyncClient(() => {}).ack(), /acknowledgement/);
});
