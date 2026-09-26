// Live Collab's relay as a Cloudflare Worker: one Durable Object per room, so it needs no server of your own and has a permanent wss:// address.
// It holds only encrypted data it cannot read (see ../server/room.mjs, which it shares with the Node relay), in memory, and forgets a room when
// the last person leaves. Deploy: see the README ("Run the relay on Cloudflare").
import { Room } from "../server/room.mjs";

/** One live room. Cloudflare keeps one of these per room name and routes every person of that room to it. */
export class LiveRoom {
  room = new Room();

  fetch() {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const peer = {
      send: (bytes) => {
        try {
          server.send(bytes);
        } catch {
          // that person has gone
        }
      },
    };
    if (!this.room.join(peer)) server.close(1013, "full");
    server.addEventListener("message", (e) => {
      if (e.data instanceof ArrayBuffer) this.room.message(peer, new Uint8Array(e.data));
    });
    const gone = () => this.room.leave(peer);
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Granite Live Collab relay\n");
    // The room is the URL path: 32 letters and digits (a hash of the room's secret). Refuse anything else.
    const room = new URL(request.url).pathname.slice(1);
    if (!/^[a-z0-9]{32}$/.test(room)) return new Response("Bad room", { status: 400 });
    // One address may only open so many connections a minute (wrangler.toml), so nobody can use up the relay everyone shares.
    if (env.JOIN_LIMIT && !(await env.JOIN_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "" })).success) {
      return new Response("Too many connections, try again in a minute", { status: 429 });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
};
