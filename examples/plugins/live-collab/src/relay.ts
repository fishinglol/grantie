/**
 * The connection to the relay, with everything end-to-end encrypted. Replaces y-websocket: the relay only keeps and passes on opaque blobs
 * (server/room.mjs), so it can't read the note. The room's secret (the 32 characters in the invite) never leaves the devices: the room's name
 * on the wire is a hash of it, and the AES-GCM key is another hash of it.
 */
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

const UPDATE = 1;
const CAUGHT_UP = 3;
const AWARENESS = 4;
const TOO_MANY = 254;
const LOG_FULL = 255;
const REMOTE = { remote: true };
const enc = new TextEncoder();

async function digest(label: string, secret: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`granite-live-${label}:${secret}`)));
}

/** What the relay sees of a room: a name that can't be turned back into the secret. */
export async function roomName(secret: string): Promise<string> {
  return [...(await digest("room", secret))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await digest("key", secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** iv (12 bytes) followed by the ciphertext; the room name is authenticated too, so a blob can't be moved to another room. */
export async function seal(key: CryptoKey, room: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(room) }, key, plain));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv);
  out.set(cipher, 12);
  return out;
}

export async function open(key: CryptoKey, room: string, blob: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12), additionalData: enc.encode(room) }, key, blob.slice(12)));
}

type Status = { status: "connecting" | "connected" | "disconnected" };

export class RelayProvider {
  readonly awareness: awarenessProtocol.Awareness;
  synced = false;
  readonly #ydoc: Y.Doc;
  readonly #server: string;
  readonly #ready: Promise<{ room: string; key: CryptoKey }>;
  readonly #listeners = { sync: new Set<(ok: boolean) => void>(), status: new Set<(e: Status) => void>(), error: new Set<(message: string) => void>() };
  #ws: WebSocket | null = null;
  #destroyed = false;
  #everConnected = false;
  #retry = 1000;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Sends and receives go one after the other (encryption is async), so a goodbye is not overtaken by the message before it. */
  #queue: Promise<void> = Promise.resolve();

  constructor(server: string, secret: string, ydoc: Y.Doc) {
    if (!globalThis.crypto?.subtle) throw new Error("this device can't encrypt here, so live editing is switched off (it needs a secure page)");
    this.#server = server;
    this.#ydoc = ydoc;
    this.awareness = new awarenessProtocol.Awareness(ydoc);
    this.#ready = Promise.all([roomName(secret), importKey(secret)]).then(([room, key]) => ({ room, key }));
    ydoc.on("update", this.#onUpdate);
    this.awareness.on("update", this.#onAwareness);
    void this.#ready.then(() => this.#connect());
  }

  on(event: "sync", fn: (ok: boolean) => void): void;
  on(event: "status", fn: (e: Status) => void): void;
  on(event: "error", fn: (message: string) => void): void;
  on(event: "sync" | "status" | "error", fn: never): void {
    (this.#listeners[event] as Set<unknown>).add(fn);
  }
  off(event: "sync" | "status" | "error", fn: unknown): void {
    (this.#listeners[event] as Set<unknown>).delete(fn);
  }
  #emit(event: "sync" | "status" | "error", value: unknown): void {
    for (const fn of this.#listeners[event] as Set<(v: unknown) => void>) fn(value);
  }

  #connect(): void {
    if (this.#destroyed) return;
    void this.#ready.then(({ room }) => {
      this.#emit("status", { status: "connecting" });
      const ws = new WebSocket(`${this.#server}/${room}`);
      ws.binaryType = "arraybuffer";
      this.#ws = ws;
      ws.onopen = () => {
        this.#retry = 1000;
        this.#emit("status", { status: "connected" });
        // What was typed while offline reaches the others as one full update (Yjs merges it, and ignores what they already have).
        if (this.#everConnected) this.#send(UPDATE, Y.encodeStateAsUpdate(this.#ydoc));
        this.#everConnected = true;
        this.#sendAwareness();
      };
      ws.onmessage = (e) => {
        const data = new Uint8Array(e.data as ArrayBuffer);
        this.#queue = this.#queue.then(() => this.#receive(data)).catch(() => {});
      };
      ws.onclose = () => {
        if (this.#ws === ws) this.#ws = null;
        if (this.synced) {
          this.synced = false;
          this.#emit("sync", false);
        }
        this.#emit("status", { status: "disconnected" });
        if (!this.#destroyed) {
          this.#timer = setTimeout(() => this.#connect(), this.#retry);
          this.#retry = Math.min(this.#retry * 2, 10_000);
        }
      };
      ws.onerror = () => {};
    });
  }

  async #receive(data: Uint8Array): Promise<void> {
    const type = data[0];
    if (type === CAUGHT_UP) {
      this.synced = true;
      return this.#emit("sync", true);
    }
    if (type === TOO_MANY) return this.#emit("error", "this live session already has as many people as it can take");
    if (type === LOG_FULL) return this.#emit("error", "this live session has run out of room. Start a new one from the Share window");
    if (type !== UPDATE && type !== AWARENESS) return;
    const { room, key } = await this.#ready;
    let plain: Uint8Array;
    try {
      plain = await open(key, room, data.subarray(1));
    } catch {
      return; // not ours (wrong key or tampered with): ignored
    }
    if (type === UPDATE) return Y.applyUpdate(this.#ydoc, plain, REMOTE);
    const before = new Set(this.awareness.getStates().keys());
    awarenessProtocol.applyAwarenessUpdate(this.awareness, plain, REMOTE);
    // Somebody new: tell them where we are (they only hear about people who speak after they arrive). They know us now, so this does not loop.
    if ([...this.awareness.getStates().keys()].some((id) => !before.has(id))) this.#sendAwareness();
  }

  #send(type: number, plain: Uint8Array): void {
    this.#queue = this.#queue
      .then(async () => {
        const ws = this.#ws;
        if (!ws || ws.readyState !== 1) return;
        const { room, key } = await this.#ready;
        const blob = await seal(key, room, plain);
        const out = new Uint8Array(1 + blob.length);
        out[0] = type;
        out.set(blob, 1);
        ws.send(out);
      })
      .catch(() => {});
  }

  #sendAwareness(): void {
    if (this.awareness.getLocalState() !== null) this.#send(AWARENESS, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]));
  }

  #onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== REMOTE) this.#send(UPDATE, update);
  };

  #onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin === REMOTE || ![...added, ...updated, ...removed].includes(this.awareness.clientID)) return;
    // Also covers leaving: the state is null by now, and that null goes out before the socket is closed below.
    this.#send(AWARENESS, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]));
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.awareness.setLocalState(null); // says goodbye (a no-op when it already did)
    clearTimeout(this.#timer);
    this.#ydoc.off("update", this.#onUpdate);
    this.awareness.off("update", this.#onAwareness);
    this.#queue = this.#queue.then(() => {
      this.#ws?.close();
      this.#ws = null;
    });
    this.awareness.destroy();
  }
}
