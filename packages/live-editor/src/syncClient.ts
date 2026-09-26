import { ChangeSet } from "@codemirror/state";

/**
 * Live sync between the editor and a plugin (plugin API 6). The plugin is the "authority": it holds the shared
 * document, puts every edit in an ordered log, and the editor follows that log. Only one of the editor's own edits
 * is out at a time (`inflight`); edits typed meanwhile wait, composed into one, in `buffer`. An edit that arrives
 * from the authority is transformed over both, so the editor keeps its cursor and the user's typing is never held back.
 *
 * Pure (no DOM, no view), so it can be tested on its own. Positions and edits travel as CodeMirror `ChangeSet` JSON.
 */
export type SyncEvent =
  /** The user (or a sync from disk) changed the note. `changes` is `ChangeSet.toJSON()`, based on the authority's log entry number `base`. */
  | { type: "change"; base: number; changes: unknown }
  /** The caret / selection, sent only while nothing is waiting for the authority, so `base` is exact. */
  | { type: "selection"; base: number; anchor: number; head: number }
  /** The session is over (another note was opened, the editor closed, or an edit didn't fit). */
  | { type: "ended"; reason?: string };

export class SyncClient {
  /** How many entries of the authority's log (its own remote edits and the acknowledgements of ours) this editor has taken in. */
  base = 0;
  #inflight: ChangeSet | null = null;
  #buffer: ChangeSet | null = null;
  readonly #send: (event: SyncEvent) => void;

  constructor(send: (event: SyncEvent) => void) {
    this.#send = send;
  }

  /** Nothing waits for the authority, so the editor's text is exactly the authority's at `base`. */
  get synced(): boolean {
    return this.#inflight === null;
  }

  /** The editor's own edit (already applied to its document). */
  local(changes: ChangeSet): void {
    if (this.#inflight === null) {
      this.#inflight = changes;
      this.#sendInflight();
    } else {
      this.#buffer = this.#buffer ? this.#buffer.compose(changes) : changes;
    }
  }

  /** The authority took our edit into its log. */
  ack(): void {
    if (this.#inflight === null) throw new Error("acknowledgement without an edit in flight");
    this.base++;
    this.#inflight = null;
    if (this.#buffer) {
      this.#inflight = this.#buffer;
      this.#buffer = null;
      this.#sendInflight();
    }
  }

  /**
   * An edit from the authority, based on its text at `base`. Returns what to apply to the editor's document (which also
   * holds our unconfirmed edits) and adjusts those edits to sit on top of the new text.
   */
  remote(remote: ChangeSet): ChangeSet {
    this.base++;
    const inflight = this.#inflight;
    if (inflight === null) return remote;
    // The authority puts the remote edit first and maps ours over it (`inflight.map(remote)`); we did ours first, so
    // the remote edit is mapped the other way round. `A.compose(B.map(A))` equals `B.compose(A.map(B, true))`.
    let apply = remote.map(inflight, true);
    this.#inflight = inflight.map(remote);
    if (this.#buffer) {
      const buffer = this.#buffer;
      this.#buffer = buffer.map(apply);
      apply = apply.map(buffer, true);
    }
    return apply;
  }

  /** Carry a position in the authority's text (at `base`) over our unconfirmed edits, into the editor's document. */
  toLocal(pos: number): number {
    if (this.#inflight) pos = this.#inflight.mapPos(pos, 1);
    if (this.#buffer) pos = this.#buffer.mapPos(pos, 1);
    return pos;
  }

  #sendInflight(): void {
    this.#send({ type: "change", base: this.base, changes: this.#inflight!.toJSON() });
  }
}
