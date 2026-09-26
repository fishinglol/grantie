import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SERVER, colorFor, serverFor, inviteLink, newInvite, newRoom, onlyInvite, parseInvite, parseInviteInput, parseSettings, withInvite, withSettings } from "../src/invite.ts";

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

test("the short invite link is made for a wss server and read back", () => {
  const link = inviteLink({ server: "wss://collab.example.com", room })!;
  assert.equal(link, `granite-live://collab.example.com/${room}`);
  assert.deepEqual(parseInviteInput(link), { server: "wss://collab.example.com", room });
  assert.deepEqual(parseInviteInput(`  ${link}/\n`), { server: "wss://collab.example.com", room }, "spaces and a trailing slash are forgiven");
  assert.deepEqual(parseInviteInput("granite-live://Collab.Example.com:8443/" + room), { server: "wss://collab.example.com:8443", room });
  assert.equal(inviteLink({ server: "ws://192.168.1.5:1234", room }), null, "a plain ws server is shared as the block instead");
});

test("what is pasted to join can be the link or the whole invite block, and nothing else", () => {
  assert.deepEqual(parseInviteInput(newInvite("wss://x.com", room)), { server: "wss://x.com", room });
  for (const bad of ["", "hello", "https://x.com/" + room, "granite-live://x.com/short", `granite-live://x.com/${room.toUpperCase()}`, `granite-live://x.com/evil/${room}`, `granite-live://x y.com/${room}`]) {
    assert.equal(parseInviteInput(bad), null, bad);
  }
});

test("saving settings changes the two lines and keeps the rest of the note", () => {
  assert.deepEqual(parseSettings(withSettings("", { name: "Ann", server: "wss://a.example.com" })), { name: "Ann", server: "wss://a.example.com" });
  const old = "# Live Collab\n\nname: Your name\nserver: wss://old.example.com\n\nMy own notes here.\n";
  const next = withSettings(old, { name: "Bo", server: "wss://new.example.com" });
  assert.deepEqual(parseSettings(next), { name: "Bo", server: "wss://new.example.com" });
  assert.match(next, /My own notes here\./);
  assert.equal((next.match(/^server:/gim) ?? []).length, 1);
  const bare = withSettings("just words", { name: "Cy", server: "wss://c.example.com" });
  assert.deepEqual(parseSettings(bare), { name: "Cy", server: "wss://c.example.com" });
  assert.match(bare, /^just words/);
});

test("the invite goes at the top of a note, but after its properties so they stay properties", () => {
  const block = newInvite("wss://x.com", room);
  assert.equal(withInvite("Plan\n", block), `${block}\n\nPlan\n`);
  const props = "---\ntitle: Trip\ntags: [a]\n---\n";
  assert.equal(withInvite(`${props}Plan\n`, block), `${props}${block}\n\nPlan\n`);
  assert.equal(withInvite("---\ntitle: T\n---", block), `---\ntitle: T\n---\n${block}\n\n`, "properties at the very end of the note");
  assert.equal(withInvite("--- not properties\ntext", block), `${block}\n\n--- not properties\ntext`);
  assert.deepEqual(parseInvite(withInvite(`${props}Plan\n`, block)), { server: "wss://x.com", room });
});

test("a server of your own wins, else Granite's built-in one, else there is none", () => {
  assert.equal(serverFor({ server: "wss://mine.example.com" }, "wss://granite.example.com"), "wss://mine.example.com");
  assert.equal(serverFor({}, "wss://granite.example.com"), "wss://granite.example.com");
  assert.equal(serverFor({ server: "" }, "wss://granite.example.com"), "wss://granite.example.com");
  assert.equal(serverFor({}, ""), undefined);
  assert.match(DEFAULT_SERVER, /^(|wss:\/\/[a-z0-9.-]+)$/, "empty until the Worker is deployed, else a wss address with no path");
});
