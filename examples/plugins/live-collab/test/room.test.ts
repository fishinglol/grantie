import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LOG_BYTES, MAX_PEERS, Room, T } from "../server/room.mjs";
import { open, roomName, seal } from "../src/relay.ts";

/** A stand-in for a connected person: keeps what the relay sent it. */
const person = () => {
  const got: Uint8Array[] = [];
  return { got, send: (b: Uint8Array) => void got.push(b) };
};
const blob = (type: number, ...bytes: number[]) => Uint8Array.of(type, ...bytes);

test("a newcomer is replayed every kept update in order, then told it has caught up", () => {
  const room = new Room();
  const a = person();
  room.join(a);
  room.message(a, blob(T.UPDATE, 1));
  room.message(a, blob(T.UPDATE, 2));
  const b = person();
  room.join(b);
  assert.deepEqual(b.got.map((x) => [...x]), [[1, 1], [1, 2], [T.CAUGHT_UP]]);
});

test("updates go to the others, not back to the sender; awareness goes on but is not kept", () => {
  const room = new Room();
  const a = person();
  const b = person();
  room.join(a);
  room.join(b);
  a.got.length = b.got.length = 0;
  room.message(a, blob(T.UPDATE, 7));
  room.message(a, blob(T.AWARENESS, 9));
  assert.deepEqual(b.got.map((x) => [...x]), [[1, 7], [4, 9]]);
  assert.deepEqual(a.got, []);
  const late = person();
  room.join(late);
  assert.deepEqual(late.got.map((x) => [...x]), [[1, 7], [T.CAUGHT_UP]], "the awareness message was not kept");
});

test("nothing else is accepted: unknown types, empty messages, strangers", () => {
  const room = new Room();
  const a = person();
  const b = person();
  room.join(a);
  room.join(b);
  b.got.length = 0;
  room.message(a, blob(99, 1));
  room.message(a, Uint8Array.of(T.UPDATE));
  room.message(person(), blob(T.UPDATE, 1)); // never joined
  assert.deepEqual(b.got, []);
});

test("a room takes at most MAX_PEERS people, and stops keeping updates when its list is full", () => {
  const room = new Room();
  for (let i = 0; i < MAX_PEERS; i++) assert.ok(room.join(person()));
  const extra = person();
  assert.equal(room.join(extra), false);
  assert.deepEqual([...extra.got[0]!], [T.TOO_MANY]);

  const full = new Room();
  const a = person();
  full.join(a);
  const big = new Uint8Array(1024 * 1024).fill(1);
  big[0] = T.UPDATE;
  for (let i = 0; i < MAX_LOG_BYTES / big.length; i++) full.message(a, big);
  a.got.length = 0;
  full.message(a, big);
  assert.deepEqual([...a.got[0]!], [T.LOG_FULL]);
});

test("the room's name on the wire is a hash of the secret, the same every time, and nothing like it", async () => {
  const secret = "abcdefghijklmnopqrstuvwxyz012345";
  const name = await roomName(secret);
  assert.match(name, /^[a-f0-9]{32}$/);
  assert.equal(name, await roomName(secret));
  assert.notEqual(name, await roomName(secret.replace("a", "b")));
  assert.ok(!name.includes(secret.slice(0, 6)));
});

test("sealed data opens only for the same room and key, and every seal differs", async () => {
  const { webcrypto } = await import("node:crypto");
  const key = await webcrypto.subtle.importKey("raw", new Uint8Array(32).fill(1), "AES-GCM", false, ["encrypt", "decrypt"]);
  const other = await webcrypto.subtle.importKey("raw", new Uint8Array(32).fill(2), "AES-GCM", false, ["encrypt", "decrypt"]);
  const plain = new TextEncoder().encode("Plan the trip");
  const a = await seal(key, "room-one", plain);
  const b = await seal(key, "room-one", plain);
  assert.notDeepEqual([...a], [...b], "a fresh random iv each time");
  assert.equal(new TextDecoder().decode(await open(key, "room-one", a)), "Plan the trip");
  await assert.rejects(open(other, "room-one", a), "another key");
  await assert.rejects(open(key, "room-two", a), "moved to another room");
  const damaged = a.slice();
  damaged[damaged.length - 1]! ^= 1;
  await assert.rejects(open(key, "room-one", damaged), "tampered with");
});
