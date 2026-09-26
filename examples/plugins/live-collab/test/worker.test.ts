import assert from "node:assert/strict";
import { test } from "node:test";
import { T } from "../server/room.mjs";

// The Worker can't run in Node, so its few Cloudflare-only pieces are stood in for: a WebSocketPair of two linked fake sockets, and a Response
// that accepts status 101. What is checked is the wiring (routing, joining, passing bytes on, leaving); Cloudflare itself was not run.
class FakeSocket {
  peer!: FakeSocket;
  listeners: Record<string, ((e: any) => void)[]> = {};
  received: Uint8Array[] = [];
  closed: number | null = null;
  accept() {}
  addEventListener(name: string, fn: (e: any) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  send(bytes: Uint8Array) {
    this.peer.received.push(bytes);
  }
  close(code: number) {
    this.closed = code;
  }
  emit(name: string, e: any = {}) {
    for (const fn of this.listeners[name] ?? []) fn(e);
  }
}
const pairs: FakeSocket[][] = [];
(globalThis as any).WebSocketPair = function () {
  const a = new FakeSocket();
  const b = new FakeSocket();
  a.peer = b;
  b.peer = a;
  pairs.push([a, b]);
  return { 0: a, 1: b };
};
(globalThis as any).Response = class {
  status: number;
  webSocket: FakeSocket | undefined;
  body: unknown;
  constructor(body: unknown, init: { status?: number; webSocket?: FakeSocket } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
};

const { default: worker, LiveRoom } = await import("../worker/index.js");

const upgrade = (path: string) => ({ url: `https://relay.example.com${path}`, headers: { get: (h: string) => (h === "Upgrade" ? "websocket" : null) } });
const ROOM = "0123456789abcdef0123456789abcdef";

/** The environment Cloudflare would give: one LiveRoom per room name. */
function env() {
  const rooms = new Map<string, InstanceType<typeof LiveRoom>>();
  return {
    rooms,
    ROOMS: {
      idFromName: (name: string) => name,
      get: (name: string) => {
        if (!rooms.has(name)) rooms.set(name, new LiveRoom());
        return rooms.get(name)!;
      },
    },
  };
}

test("a web address that is not a websocket gets a short hello, and a bad room name is refused", async () => {
  const e = env();
  const hello = await worker.fetch({ url: "https://relay.example.com/", headers: { get: () => null } }, e);
  assert.equal(hello.status, 200);
  for (const path of ["/", "/short", `/${ROOM}/x`, `/${ROOM.toUpperCase()}`]) assert.equal((await worker.fetch(upgrade(path), e)).status, 400, path);
  assert.equal(e.rooms.size, 0);
});

test("two people in the same room hear each other's updates; a person in another room hears nothing", async () => {
  const e = env();
  const join = async (room: string) => {
    const res = await worker.fetch(upgrade(`/${room}`), e);
    assert.equal(res.status, 101);
    const [, server] = pairs[pairs.length - 1]!;
    return { client: res.webSocket as FakeSocket, server: server! };
  };
  const a = await join(ROOM);
  const b = await join(ROOM);
  const other = await join("f".repeat(32));
  assert.deepEqual([...a.client.received[0]!], [T.CAUGHT_UP], "told it has caught up");
  a.client.received.length = b.client.received.length = other.client.received.length = 0;

  a.server.emit("message", { data: Uint8Array.of(T.UPDATE, 5, 6).buffer });
  assert.deepEqual([...b.client.received[0]!], [T.UPDATE, 5, 6]);
  assert.deepEqual(a.client.received, []);
  assert.deepEqual(other.client.received, []);
  assert.equal(e.rooms.size, 2);

  a.server.emit("message", { data: "text is ignored" });
  assert.equal(b.client.received.length, 1);

  // a newcomer to the room is replayed the kept update
  const c = await join(ROOM);
  assert.deepEqual(c.client.received.map((x) => [...x]), [[T.UPDATE, 5, 6], [T.CAUGHT_UP]]);
  a.server.emit("close");
  b.server.emit("error");
  b.server.emit("message", { data: Uint8Array.of(T.UPDATE, 1, 1).buffer });
  assert.equal(c.client.received.length, 2, "nobody is passed anything from a person who left");
});
