import assert from "node:assert/strict";
import { test } from "node:test";
import { colorFor, newInvite, newRoom, onlyInvite, parseInvite, parseSettings } from "../src/invite.ts";

const room = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

test("an invite is made and read back", () => {
  const block = newInvite("wss://collab.example.com", room);
  assert.deepEqual(parseInvite(`# Trip\n\n${block}\n\nText`), { server: "wss://collab.example.com", room });
  assert.deepEqual(parseInvite(newInvite("ws://192.168.1.5:1234/", room)), { server: "ws://192.168.1.5:1234", room });
});

test("only a whole, valid invite counts", () => {
  assert.equal(parseInvite("no block here"), null);
  assert.equal(parseInvite("```collab\nserver: https://x.com\nroom: " + room + "\n```"), null);
  assert.equal(parseInvite("```collab\nserver: wss://x.com\nroom: short\n```"), null);
  assert.equal(parseInvite("```collab\nserver: wss://x.com\n```"), null);
  assert.equal(parseInvite("```collab\nserver: wss://x.com/evil\nroom: " + room + "\n```"), null, "no path: the room is the path");
});

test("a note with only the invite is one made to join", () => {
  assert.equal(onlyInvite(newInvite("wss://x.com", room)), true);
  assert.equal(onlyInvite("\n\n" + newInvite("wss://x.com", room) + "\n\n"), true);
  assert.equal(onlyInvite(newInvite("wss://x.com", room) + "\nhello"), false);
  assert.equal(onlyInvite("hello"), false);
});

test("room ids are 32 letters and digits and don't repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const r = newRoom();
    assert.match(r, /^[a-z0-9]{32}$/);
    seen.add(r);
  }
  assert.equal(seen.size, 200);
  // uneven bytes (>= 252) are skipped, never turned into a biased letter
  assert.match(newRoom((n) => new Uint8Array(n).fill(255).map((_, i) => (i % 2 ? 255 : i % 36))), /^[a-z0-9]{32}$/);
});

test("settings come from the Live Collab note", () => {
  assert.deepEqual(parseSettings("# Live Collab\n\nname: Fais\nserver: wss://c.example.com/\n"), { name: "Fais", server: "wss://c.example.com" });
  assert.deepEqual(parseSettings("name: Ann\nserver: https://nope"), { name: "Ann" });
  assert.deepEqual(parseSettings(""), {});
});

test("a person's caret colour is one of a fixed set of #rrggbb colours", () => {
  for (const id of [0, 1, 7, 8, 123456789, -5]) assert.match(colorFor(id), /^#[0-9a-f]{6}$/);
  assert.equal(colorFor(42), colorFor(42));
});
