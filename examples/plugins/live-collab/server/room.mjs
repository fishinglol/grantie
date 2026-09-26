// One live room, as the relay sees it: an ordered list of encrypted blobs. The relay never has the key, so it cannot read them; it replays the
// list to whoever joins, passes new blobs on to the others, and forgets everything when the last person leaves. Shared by the Node relay
// (server.mjs) and the Cloudflare Worker (worker/index.js).
//
// Wire format (binary): the first byte says what it is, the rest is opaque.
//   1 UPDATE     an encrypted change to the note. Kept in the list, replayed to newcomers, passed to the others.
//   4 AWARENESS  an encrypted "who I am and where my cursor is". Passed to the others, not kept.
//   3 CAUGHT_UP  (relay -> client) everything that was kept has been replayed.
//   254 / 255    (relay -> client) the room has too many people / is full.
export const T = { UPDATE: 1, CAUGHT_UP: 3, AWARENESS: 4, TOO_MANY: 254, LOG_FULL: 255 };
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
export const MAX_PEERS = 20;

export class Room {
  #log = [];
  #bytes = 0;
  #peers = new Set();

  get size() {
    return this.#peers.size;
  }

  /** `peer` is `{ send(bytes: Uint8Array) }`. Returns false (after telling it why) when the room won't take another person. */
  join(peer) {
    if (this.#peers.size >= MAX_PEERS) {
      peer.send(Uint8Array.of(T.TOO_MANY));
      return false;
    }
    this.#peers.add(peer);
    for (const blob of this.#log) peer.send(blob);
    peer.send(Uint8Array.of(T.CAUGHT_UP));
    return true;
  }

  leave(peer) {
    this.#peers.delete(peer);
  }

  message(peer, data) {
    if (!this.#peers.has(peer) || data.length < 2) return;
    if (data[0] === T.UPDATE) {
      if (this.#bytes + data.length > MAX_LOG_BYTES) return peer.send(Uint8Array.of(T.LOG_FULL));
      this.#log.push(data);
      this.#bytes += data.length;
    } else if (data[0] !== T.AWARENESS) {
      return; // anything else is ignored
    }
    for (const other of this.#peers) if (other !== peer) other.send(data);
  }
}
