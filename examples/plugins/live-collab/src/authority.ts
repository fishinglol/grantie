import * as Y from "yjs";
import { ChangeSet, type ChangeSpec } from "@codemirror/state";

/** Origin of Yjs changes that came from this device's own editor (they must not be sent back to it). */
export const LOCAL = Symbol("local editor");

export interface Hooks {
  /** An edit from somebody else, for the editor (`ChangeSet` JSON, based on the text after every entry sent so far). */
  remote(changes: unknown): void;
  /** The editor's edit was taken in. */
  ack(): void;
}

/**
 * The plugin's half of plugin API 6's live session: it holds the shared text (`ytext`) and an ordered log of every entry the editor has
 * to follow. The editor's edits come in through `receive` (mapped over what it hasn't seen yet, then written to Yjs); other people's
 * changes arrive as Yjs events and go out through `hooks.remote`.
 */
export class Authority {
  readonly #ydoc: Y.Doc;
  readonly #ytext: Y.Text;
  readonly #hooks: Hooks;
  /** Log entries from number `#first` on (older ones the editor has taken in are dropped). */
  #entries: ChangeSet[] = [];
  #first = 0;
  /** Length of the text after every entry so far, which is also what `ytext` holds. */
  #length: number;

  constructor(ydoc: Y.Doc, ytext: Y.Text, hooks: Hooks, length: number) {
    this.#ydoc = ydoc;
    this.#ytext = ytext;
    this.#hooks = hooks;
    this.#length = length;
    ytext.observe(this.#onYjs);
  }

  destroy(): void {
    this.#ytext.unobserve(this.#onYjs);
  }

  /** The editor's edit, based on log entry `base`. Throws if it doesn't fit (the session should then end). */
  receive(base: number, json: unknown): void {
    let changes = ChangeSet.fromJSON(json);
    for (const entry of this.#entries.slice(Math.max(0, base - this.#first))) changes = changes.map(entry);
    if (changes.length !== this.#length) throw new Error("an edit does not fit the shared text");
    this.#ydoc.transact(() => applyToText(this.#ytext, changes), LOCAL);
    this.#push(changes, base);
    this.#hooks.ack();
  }

  /** Make the editor's text (`current`) equal to `wanted` (the room's), as an entry from somebody else. */
  replace(current: string, wanted: string): void {
    if (current === wanted) return;
    let from = 0;
    const shared = Math.min(current.length, wanted.length);
    while (from < shared && current.charCodeAt(from) === wanted.charCodeAt(from)) from++;
    let endCurrent = current.length;
    let endWanted = wanted.length;
    while (endCurrent > from && endWanted > from && current.charCodeAt(endCurrent - 1) === wanted.charCodeAt(endWanted - 1)) {
      endCurrent--;
      endWanted--;
    }
    const changes = ChangeSet.of({ from, to: endCurrent, insert: wanted.slice(from, endWanted) }, current.length);
    this.#push(changes);
    this.#hooks.remote(changes.toJSON());
  }

  /** A position the editor reported at log entry `base`, carried to the text as it is now. */
  mapPosition(base: number, pos: number): number {
    for (const entry of this.#entries.slice(Math.max(0, base - this.#first))) pos = entry.mapPos(pos, 1);
    return pos;
  }

  #push(changes: ChangeSet, editorBase?: number): void {
    this.#length = changes.newLength;
    this.#entries.push(changes);
    // The editor has taken in every entry before its `base`, so nothing needs them again.
    if (editorBase !== undefined && editorBase > this.#first) {
      this.#entries.splice(0, editorBase - this.#first);
      this.#first = editorBase;
    }
  }

  #onYjs = (event: Y.YTextEvent, tr: Y.Transaction): void => {
    if (tr.origin === LOCAL) return;
    const specs: ChangeSpec[] = [];
    let pos = 0;
    for (const op of event.delta) {
      if (op.retain !== undefined) pos += op.retain;
      else if (op.delete !== undefined) {
        specs.push({ from: pos, to: pos + op.delete });
        pos += op.delete;
      } else if (typeof op.insert === "string") specs.push({ from: pos, insert: op.insert });
    }
    if (specs.length === 0) return;
    const changes = ChangeSet.of(specs, this.#length);
    this.#push(changes);
    this.#hooks.remote(changes.toJSON());
  };
}

/** Write a `ChangeSet` (positions in the text before it) into a Yjs text. */
function applyToText(ytext: Y.Text, changes: ChangeSet): void {
  let shift = 0;
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const at = fromA + shift;
    if (toA > fromA) ytext.delete(at, toA - fromA);
    const text = inserted.toString();
    if (text) ytext.insert(at, text);
    shift += text.length - (toA - fromA);
  });
}
