import { Annotation, ChangeSet, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { SyncClient, type SyncEvent } from "./syncClient.ts";

export type { SyncEvent } from "./syncClient.ts";

/** Marks an edit that came from the authority (a plugin's live session): the plugin must not be told about it again. */
export const Remote = Annotation.define<boolean>();

/** Somebody else's caret / selection. `anchor` and `head` are positions in the authority's text; `color` is `#rrggbb`. */
export interface SyncCursor {
  id: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
}

/** What a plugin's live session can do to the editor (plugin API 6). The plugin host reaches it through the app. */
export interface SyncPort {
  /** Start reporting edits and the caret to `listener`. Returns the note's text now, which is entry 0 of the log. */
  start(listener: (event: SyncEvent) => void): string;
  stop(): void;
  /** An edit from the authority (`ChangeSet` JSON, based on the text at the editor's current log entry). */
  remote(changes: unknown): void;
  /** The authority took the editor's edit into its log. */
  ack(): void;
  setCursors(cursors: SyncCursor[]): void;
}

const setCursors = StateEffect.define<SyncCursor[]>();

class CaretWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    super();
  }
  eq(other: CaretWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }
  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret";
    caret.style.setProperty("--peer", this.color);
    const flag = document.createElement("span");
    flag.className = "cm-remote-flag";
    flag.textContent = this.name;
    caret.append(flag);
    return caret;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/** Other people's carets and selections, in the editor's own coordinates (they follow the text as it changes). */
export const remoteCursors = StateField.define<SyncCursor[]>({
  create: () => [],
  update(cursors, tr) {
    if (tr.docChanged) {
      cursors = cursors.map((c) => ({ ...c, anchor: tr.changes.mapPos(c.anchor, 1), head: tr.changes.mapPos(c.head, 1) }));
    }
    for (const effect of tr.effects) if (effect.is(setCursors)) cursors = effect.value;
    return cursors;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (cursors): DecorationSet => {
      const ranges = cursors.flatMap((c) => {
        const from = Math.min(c.anchor, c.head);
        const to = Math.max(c.anchor, c.head);
        return [
          ...(from < to ? [Decoration.mark({ class: "cm-remote-sel", attributes: { style: `--peer:${c.color}` } }).range(from, to)] : []),
          Decoration.widget({ widget: new CaretWidget(c.name, c.color), side: 1 }).range(c.head),
        ];
      });
      return Decoration.set(ranges, true);
    }),
});

/** One live session of a view with a plugin. */
export class SyncSession {
  readonly #view: EditorView;
  readonly #listener: (event: SyncEvent) => void;
  readonly #client: SyncClient;
  #lastSelection = "";

  constructor(view: EditorView, listener: (event: SyncEvent) => void) {
    this.#view = view;
    this.#listener = listener;
    this.#client = new SyncClient(listener);
  }

  /** From the view's update listener: report the user's edits (not the authority's own) and the caret. */
  update(u: ViewUpdate): void {
    if (u.docChanged) {
      for (const tr of u.transactions) if (tr.docChanged && !tr.annotation(Remote)) this.#client.local(tr.changes);
    }
    if (u.docChanged || u.selectionSet) this.#reportSelection();
  }

  remote(json: unknown): void {
    const apply = this.#client.remote(ChangeSet.fromJSON(json));
    if (apply.length !== this.#view.state.doc.length) throw new Error("the edit does not fit the note");
    this.#view.dispatch({ changes: apply, annotations: [Remote.of(true), Transaction.addToHistory.of(false)] });
    this.#reportSelection();
  }

  ack(): void {
    this.#client.ack();
    this.#reportSelection();
  }

  setCursors(cursors: SyncCursor[]): void {
    const { doc } = this.#view.state;
    const local = (pos: number) => Math.min(Math.max(this.#client.toLocal(pos), 0), doc.length);
    this.#view.dispatch({ effects: setCursors.of(cursors.map((c) => ({ ...c, anchor: local(c.anchor), head: local(c.head) }))) });
  }

  /** Tell the plugin the session is over and take the other people's carets away. */
  end(reason?: string): void {
    this.#listener({ type: "ended", reason });
    this.clear();
  }

  clear(): void {
    if (this.#view.state.field(remoteCursors).length) this.#view.dispatch({ effects: setCursors.of([]) });
  }

  /** Only while nothing waits for the authority, so the positions are exact at `base`. */
  #reportSelection(): void {
    if (!this.#client.synced) return;
    const { anchor, head } = this.#view.state.selection.main;
    const key = `${this.#client.base}:${anchor}:${head}`;
    if (key === this.#lastSelection) return;
    this.#lastSelection = key;
    this.#listener({ type: "selection", base: this.#client.base, anchor, head });
  }
}
