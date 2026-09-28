import { Transaction, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Where the caret is, in the window's own pixels (what a `position: fixed` layer over the whole window draws in). */
export interface CaretRect {
  /** Left edge of the caret and top of its line. */
  x: number;
  y: number;
  /** Width of the character after the caret (an average character at the end of a line). */
  width: number;
  /** Height of the line. */
  height: number;
}

/**
 * What a plugin's overlay is told (plugin API 8, `editor.caret`). `caret` is null when there is nothing to draw: the editor has no
 * focus, or the caret is scrolled out of sight.
 */
export type CaretEvent =
  | { type: "move"; caret: CaretRect | null; selecting: boolean; scroll: boolean }
  | { type: "type"; text: string; caret: CaretRect | null }
  | { type: "delete"; text: string; caret: CaretRect | null }
  | { type: "enter"; caret: CaretRect | null };

/** What the editor needs from the plugin host; `BlockRenderer` carries it, like the rest of what plugins draw. */
export interface CaretSink {
  /** True while a plugin draws over the editor (nothing is measured or sent otherwise). */
  wantsCaret(): boolean;
  caret(event: CaretEvent): void;
}

/** Longest text a `type` / `delete` event carries (a paste is not one of them, but a composed word can be long). */
const MAX_TEXT = 32;

/**
 * What one edit was, if it is worth telling a plugin: a character typed, text deleted, or Enter. Pastes, drops, and edits made by
 * the app or a plugin (no user event) are not: an effect that fires on every one of those would be noise, or a way to be spammed.
 */
export function classifyChange(userEvent: string | undefined, inserted: string, deleted: string): { type: "type" | "delete" | "enter"; text: string } | null {
  if (!userEvent) return null;
  if (userEvent === "input" && inserted.startsWith("\n")) return { type: "enter", text: "" };
  if (userEvent === "input.type" || userEvent.startsWith("input.type.")) return inserted === "" ? null : { type: "type", text: inserted.slice(0, MAX_TEXT) };
  if (userEvent.startsWith("delete")) return deleted === "" ? null : { type: "delete", text: deleted.slice(0, MAX_TEXT) };
  return null;
}

function changeOf(tr: Transaction): ReturnType<typeof classifyChange> {
  let inserted = "";
  let deleted = "";
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    if (inserted === "" && deleted === "") {
      inserted = text.toString();
      deleted = tr.startState.sliceDoc(fromA, toA);
    }
  });
  return classifyChange(tr.annotation(Transaction.userEvent), inserted, deleted);
}

function measure(view: EditorView): { caret: CaretRect | null; selecting: boolean } {
  const { main } = view.state.selection;
  const selecting = !main.empty;
  if (!view.hasFocus) return { caret: null, selecting };
  const at = view.coordsAtPos(main.head);
  if (!at) return { caret: null, selecting };
  const scroller = view.scrollDOM.getBoundingClientRect();
  if (at.bottom < scroller.top || at.top > scroller.bottom) return { caret: null, selecting };
  const next = main.head < view.state.doc.length ? view.coordsAtPos(main.head + 1) : null;
  const sameLine = next && Math.abs(next.top - at.top) < 2 && next.left > at.left;
  return { caret: { x: at.left, y: at.top, width: sameLine ? next.left - at.left : view.defaultCharacterWidth, height: at.bottom - at.top }, selecting };
}

/**
 * Tells the sink where the caret is (after each layout, so the numbers are what is on screen) and when the user types, deletes or
 * presses Enter. Does nothing while `getSink()` is null or `wantsCaret()` is false.
 */
export function caretEvents(getSink: () => CaretSink | null): Extension {
  return ViewPlugin.fromClass(
    class {
      /** Edits since the last measurement; each is sent with the caret as it is after them. */
      #queue: NonNullable<ReturnType<typeof classifyChange>>[] = [];
      #last = "";
      #hadCaret = false;
      /** Nothing but scrolling or resizing happened since the last report (so the caret moved on screen, not in the text). */
      #onlyScroll = true;
      readonly #onScroll = () => this.#schedule();
      /**
       * A block plugin's iframe lives inside the editor's own DOM (as a widget), so clicking into it moves the browser's
       * focus to a descendant of `view.dom`, not away from it. CodeMirror's own focus tracking (`ViewUpdate.focusChanged`)
       * reconciles that asynchronously and can miss it entirely (an update with nothing else changed is easy to coalesce
       * away), which left a stale caret drawn over old text while the user was really typing in a table cell. `focusout`
       * bubbles and fires the moment focus leaves anything under `view.dom` — including into that iframe — so it catches
       * every case `focusChanged` does and this one it doesn't.
       */
      readonly #onFocusOut = () => {
        this.#onlyScroll = false;
        this.#schedule();
      };

      readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        view.scrollDOM.addEventListener("scroll", this.#onScroll, { passive: true });
        window.addEventListener("resize", this.#onScroll);
        view.dom.addEventListener("focusout", this.#onFocusOut);
      }

      update(u: ViewUpdate): void {
        if (!getSink()?.wantsCaret()) {
          this.#queue = [];
          return;
        }
        if (u.docChanged) {
          for (const tr of u.transactions) {
            const change = tr.docChanged ? changeOf(tr) : null;
            if (change) this.#queue.push(change);
          }
        }
        if (u.docChanged || u.selectionSet || u.focusChanged) this.#onlyScroll = false;
        if (u.docChanged || u.selectionSet || u.focusChanged || u.geometryChanged || u.viewportChanged) this.#schedule();
      }

      #schedule(): void {
        if (!getSink()?.wantsCaret()) return;
        this.view.requestMeasure({ key: this, read: (view) => (view.dom.getClientRects().length === 0 ? null : measure(view)), write: (m) => this.#flush(m) });
      }

      #flush(m: ReturnType<typeof measure> | null): void {
        const sink = getSink();
        const queue = this.#queue;
        this.#queue = [];
        if (!sink?.wantsCaret() || !m) return; // a hidden editor (another note's) says nothing
        // A view without the caret only reports losing it, so two panes don't overwrite each other's "here".
        if (!m.caret && !this.#hadCaret) return;
        this.#hadCaret = m.caret !== null;
        const scroll = this.#onlyScroll;
        this.#onlyScroll = true;
        const key = JSON.stringify([m.caret, m.selecting]);
        if (key !== this.#last) {
          this.#last = key;
          sink.caret({ type: "move", caret: m.caret, selecting: m.selecting, scroll });
        }
        for (const change of queue) sink.caret({ ...change, caret: m.caret } as CaretEvent);
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener("scroll", this.#onScroll);
        window.removeEventListener("resize", this.#onScroll);
        this.view.dom.removeEventListener("focusout", this.#onFocusOut);
      }
    },
  );
}
