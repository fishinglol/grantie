/// <reference types="vite/client" />
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  type Text,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  scrollPastEnd,
  showTooltip,
  type TooltipView,
  WidgetType,
} from "@codemirror/view";
import { dirname, IMAGE_FILE, join, toggleFormat, type InlineFormat } from "@granite/core-notes";
import { openImageViewer } from "./imageViewer";
import NoteTitle from "./NoteTitle";
import { Remote, remoteCursors, SyncSession, type SyncPort } from "./sync.ts";

export { IMAGE_FILE };

/**
 * Obsidian-style "live preview" editor: the document stays plain Markdown, but
 * syntax is styled in place and markers (#, **, [](), ---) are hidden on every
 * line except the one the cursor is on.
 */

const External = Annotation.define<boolean>();

/** How many notes' editors a pane keeps alive (hidden) so that coming back to one is instant. */
const MAX_KEPT_EDITORS = 4;
const refresh = StateEffect.define<null>();

/**
 * Reading mode: no caret, no typing, and no edits from the image toolbar. Text arriving from outside (`External`: a
 * sync, another pane on the same note, a live session's `Remote` edits) and plugin blocks (`input.plugin`, e.g. a sheet saving itself) still go through.
 */
const readingFacet = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });
const readingMode = (on: boolean) =>
  on
    ? [
        readingFacet.of(true),
        EditorView.editable.of(false),
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && !tr.annotation(External) && !tr.annotation(Remote) && !tr.isUserEvent("input.plugin") ? [] : tr,
        ),
      ]
    : [];

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.textContent = "•";
    return el;
  }
}

/** Splits a trailing Obsidian-style `|width` (or `|widthxheight`) off an alt text / embed name. */
function splitSize(text: string): { base: string; width: number | null } {
  const m = /^(.*)\|(\d+)(?:x\d+)?$/.exec(text);
  return m ? { base: m[1]!, width: Number(m[2]) } : { base: text, width: null };
}

/** The image that is currently selected (clicked), by its range in the note. */
const setSel = StateEffect.define<{ from: number; to: number } | null>();
const selectedField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(sel, tr) {
    for (const e of tr.effects) if (e.is(setSel)) return e.value;
    // Moving the cursor or editing text elsewhere deselects.
    return tr.selection || tr.docChanged ? null : sel;
  },
});

/** Range to delete so an image (and the line it sat alone on) disappears cleanly. */
function imageRemoval(doc: Text, from: number, to: number): { from: number; to: number } {
  const line = doc.lineAt(from);
  if (line.from === from && line.to === to) {
    return to < doc.length ? { from, to: to + 1 } : { from: Math.max(0, from - 1), to };
  }
  return { from, to };
}

interface ImageProps {
  src: string;
  alt: string;
  width: number | null;
  /** The whole image syntax in the note. */
  from: number;
  to: number;
  /** Doc range holding "<base>|<width>": the alt text (Markdown) or the name inside `![[ ]]`. */
  sizeFrom: number;
  sizeTo: number;
  base: string;
  selected: boolean;
}

const ICON_ZOOM =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>';

/**
 * An image in the note. Click selects it (toolbar: zoom viewer, edit source); drag
 * the corner handle to resize, which writes `|width` into the note (`![[shot.png|538]]`);
 * drag the picture itself to move it elsewhere in the note.
 */
class ImageWidget extends WidgetType {
  constructor(readonly p: ImageProps) {
    super();
  }
  eq(o: ImageWidget) {
    const a = this.p;
    const b = o.p;
    return (
      a.src === b.src && a.alt === b.alt && a.width === b.width && a.from === b.from && a.to === b.to &&
      a.sizeFrom === b.sizeFrom && a.sizeTo === b.sizeTo && a.base === b.base && a.selected === b.selected
    );
  }
  writeWidth(view: EditorView, width: number | null) {
    const { p } = this;
    const insert = width ? `${p.base}|${width}` : p.base;
    const newTo = p.to + insert.length - (p.sizeTo - p.sizeFrom);
    view.dispatch({
      changes: { from: p.sizeFrom, to: p.sizeTo, insert },
      effects: setSel.of({ from: p.from, to: newTo }),
    });
  }
  /** Doc position a drag over (x, y) would drop at, or null when that isn't a valid spot. */
  dropTarget(view: EditorView, x: number, y: number): number | null {
    const pos = view.posAtCoords({ x, y });
    if (pos == null || (pos >= this.p.from && pos <= this.p.to)) return null;
    const fm = frontmatterRange(view.state);
    return fm && pos <= fm.to ? null : pos;
  }
  moveTo(view: EditorView, pos: number) {
    const { doc } = view.state;
    const { from, to } = this.p;
    const text = doc.sliceString(from, to);
    const del = imageRemoval(doc, from, to);
    const line = doc.lineAt(pos);
    // Dropped on an empty line it takes the line; at a line edge it becomes its own line; mid-line it goes inline.
    const lead = line.text !== "" && pos === line.to && pos !== line.from ? 1 : 0;
    const insert = line.text === "" ? text : pos === line.from ? `${text}\n` : pos === line.to ? `\n${text}` : text;
    const start = (pos > del.from ? pos - (del.to - del.from) : pos) + lead;
    view.dispatch({
      changes: [{ from: del.from, to: del.to }, { from: pos, insert }],
      effects: [setSel.of({ from: start, to: start + text.length }), setDrop.of(null)],
      scrollIntoView: true,
    });
  }
  toDOM(view: EditorView) {
    const { p } = this;
    const wrap = document.createElement("span");
    wrap.className = p.selected ? "cm-img-wrap selected" : "cm-img-wrap";
    const img = document.createElement("img");
    img.className = "cm-image";
    img.src = p.src;
    img.alt = p.alt;
    if (p.width) img.style.width = `${p.width}px`;

    const size = document.createElement("span");
    size.className = "cm-img-size";
    const updateSize = () => {
      const r = img.getBoundingClientRect();
      size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    };
    img.addEventListener("load", () => {
      view.requestMeasure();
      updateSize();
    });

    const bar = document.createElement("div");
    bar.className = "cm-img-bar";
    const barButton = (html: string, title: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      b.innerHTML = html;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", run);
      return b;
    };
    bar.append(
      barButton(ICON_ZOOM, "Zoom", () => openImageViewer(p.src, p.alt)),
      barButton("&lt;/&gt;", "Edit source", () => {
        view.dispatch({ selection: { anchor: p.from + 2 } });
        view.focus();
      }),
    );

    // Click selects; dragging (past a few pixels) moves the image to wherever it is dropped.
    img.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let ghost: HTMLImageElement | null = null;
      let target: number | null = null;
      const onMove = (ev: MouseEvent) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          ghost = document.createElement("img");
          ghost.className = "img-drag-ghost";
          ghost.src = p.src;
          document.body.append(ghost);
          wrap.classList.add("dragging");
        }
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 12}px`;
        target = this.dropTarget(view, ev.clientX, ev.clientY);
        view.dispatch({ effects: setDrop.of(target) });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!ghost) {
          view.dispatch({ effects: setSel.of({ from: p.from, to: p.to }) });
          view.focus();
          return;
        }
        ghost.remove();
        wrap.classList.remove("dragging");
        if (target != null) this.moveTo(view, target);
        else view.dispatch({ effects: setDrop.of(null) });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    const handle = document.createElement("span");
    handle.className = "cm-img-handle";
    handle.title = "Drag to resize · double-click to reset";
    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.writeWidth(view, null);
    });
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = img.getBoundingClientRect().width;
      const maxWidth = view.contentDOM.clientWidth;
      const onMove = (ev: MouseEvent) => {
        img.style.width = `${Math.min(maxWidth, Math.max(40, startWidth + ev.clientX - startX))}px`;
        updateSize();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const next = Math.round(img.getBoundingClientRect().width);
        if (next !== Math.round(startWidth)) this.writeWidth(view, next);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    wrap.append(img, bar, handle, size);
    return wrap;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(
    readonly rows: [string, string][],
    readonly enterPos: number,
  ) {
    super();
  }
  eq(other: FrontmatterWidget) {
    return other.enterPos === this.enterPos && JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-props";
    for (const [key, value] of this.rows) {
      const row = document.createElement("div");
      row.className = "cm-props-row";
      const k = document.createElement("span");
      k.className = "cm-props-key";
      k.textContent = key;
      const v = document.createElement("span");
      v.className = "cm-props-val";
      const list = /^\[(.*)\]$/.exec(value);
      if (list) {
        for (const item of list[1]!.split(",").map((s) => s.trim()).filter(Boolean)) {
          const chip = document.createElement("span");
          chip.className = "cm-props-chip";
          chip.textContent = item;
          v.append(chip);
        }
      } else {
        v.textContent = value;
      }
      row.append(k, v);
      box.append(row);
    }
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.enterPos } });
      view.focus();
    });
    return box;
  }
}

function splitRow(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (text[i] === "|") {
      cells.push(cell);
      cell = "";
    } else cell += text[i];
  }
  cells.push(cell);
  if (text.startsWith("|")) cells.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) cells.pop();
  return cells.map((c) => c.trim());
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Tiny inline-Markdown renderer for table cells (code, bold, italic, strike, links). */
function renderInline(text: string, parent: HTMLElement) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) parent.append(text.slice(last, m.index));
    const el = document.createElement(m[1] != null ? "code" : m[2] != null ? "strong" : m[3] != null ? "del" : m[4] != null ? "em" : "span");
    if (m[1] != null) el.textContent = m[1];
    else if (m[5] != null) {
      el.className = "cm-link";
      el.textContent = m[5];
    } else renderInline((m[2] ?? m[3] ?? m[4])!, el);
    parent.append(el);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

/**
 * Lets plugins draw fenced blocks (```sheet … ```) inside the note. The app builds one (`BlockBridge` from
 * `@granite/plugins/host`) and hands it to the editor; the editor knows nothing about plugins beyond this.
 */
export interface BlockActions {
  /** Rewrite the text between the fences. */
  save(source: string): void;
  /** Delete the whole block, fences included. */
  remove(): void;
  /** Put the cursor inside the block, which turns it back into plain text. */
  edit(): void;
}

/** One entry of the `//` list. */
export interface MenuItemInfo {
  key: string;
  name: string;
  description: string;
  plugin: string;
}

/** How a link to a site a plugin knows is drawn: the site's icon and colour, and what to call it until its real title is known. */
export interface LinkChipInfo {
  /** What `runInput("link", …)` takes to ask the plugin for the page's title. */
  key: string;
  name: string;
  label: string;
  color: string;
  /** An image URL (`data:image/svg+xml,…`). */
  icon: string;
}

export interface BlockRenderer {
  /** Languages that currently have a renderer. */
  langs(): string[];
  /** Name to show for a language's blocks (the plugin's name), e.g. on the canvas toolbar. */
  label?(lang: string): string;
  /** `listener` runs when `langs()` changed. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Texts plugins want to see typed alone on an empty line (`//`), and the plugin's answer: what to put there, or null. */
  triggers?(): string[];
  /** True when a plugin wants to see pasted spreadsheet text (anything with a tab in it). */
  hasPasteHook?(): boolean;
  /** The entries of the list that opens when the user types `//` alone on an empty line. */
  menuItems?(): MenuItemInfo[];
  /** The chip a link to `url` is drawn as, or null when no plugin knows that site. */
  linkChip?(url: string): LinkChipInfo | null;
  /** `item`: `payload.text` is a `MenuItemInfo.key`. `link`: `payload.text` is a `LinkChipInfo.key`, `payload.url` the address; answers with the page's title. */
  runInput?(kind: "trigger" | "paste" | "item" | "link", payload: { text: string; html?: string; url?: string }): Promise<string | null>;
  /** Draw a block into `el`. */
  mount(lang: string, el: HTMLElement, source: string, actions: BlockActions): { update(source: string): void; destroy(): void };
}

const blockMounts = new WeakMap<HTMLElement, ReturnType<BlockRenderer["mount"]>>();

/**
 * Put what a plugin returned at `from`–`to`. Text with line breaks (a table, say) gets its own paragraph, with
 * blank lines around it as needed; a single line goes in as typed.
 */
function insertPluginText(view: EditorView, from: number, to: number, text: string) {
  const { doc } = view.state;
  from = Math.min(from, doc.length);
  to = Math.min(Math.max(to, from), doc.length);
  let insert = text;
  if (text.includes("\n")) {
    const before = doc.sliceString(Math.max(0, from - 2), from);
    const after = doc.sliceString(to, to + 1);
    insert = (from === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") + text + (after === "" || after === "\n" ? "\n" : "\n\n");
  }
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input.plugin" });
}

/**
 * Plugin input hooks: typing a trigger (`//`) alone on an empty line, and pasting text that has tabs in it (rows
 * copied from a spreadsheet). The plugin answers asynchronously; until it does, the typed / pasted text is held back,
 * and if it declines (or fails) the text goes in as if nothing had happened.
 */
function pluginInput(getBlocks: () => BlockRenderer | null) {
  return [
    EditorView.inputHandler.of((view, from, to, text) => {
      const blocks = getBlocks();
      const { state } = view;
      if (!blocks?.triggers || !blocks.runInput || from !== to || text === "" || text.includes("\n") || state.facet(readingFacet)) return false;
      const line = state.doc.lineAt(from);
      // What the line would read after this input. Judged as a whole (not by where the character lands) because
      // typing `/` next to an existing `/` may be reported as inserted before or after it.
      const typed = state.sliceDoc(line.from, from) + text + state.sliceDoc(from, line.to);
      // `//` opens the list (`slashMenu`) when any plugin offers an entry; the text is typed as usual.
      if (typed === "//" && blocks.menuItems?.().length) return false;
      if (!blocks.triggers().includes(typed) || inCodeBlock(state, from)) return false;
      view.dispatch({ changes: { from: line.from, to: line.to }, userEvent: "delete" });
      void blocks.runInput("trigger", { text: typed }).then((out) => insertPluginText(view, line.from, line.from, out ?? typed));
      return true;
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const blocks = getBlocks();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!blocks?.hasPasteHook?.() || !blocks.runInput || !text.includes("\t") || view.state.facet(readingFacet)) return false;
        const { from, to } = view.state.selection.main;
        if (inCodeBlock(view.state, from)) return false;
        event.preventDefault();
        const html = event.clipboardData?.getData("text/html") ?? "";
        void blocks.runInput("paste", { text, html }).then((out) => {
          if (out !== null) return insertPluginText(view, from, to, out);
          const end = Math.min(to, view.state.doc.length);
          view.dispatch({ changes: { from: Math.min(from, end), to: end, insert: text }, selection: { anchor: Math.min(from, end) + text.length }, userEvent: "input.paste" });
        });
        return true;
      },
    }),
  ];
}

interface SlashMenu {
  /** Start of the line the `//` is on. */
  line: number;
  items: MenuItemInfo[];
  query: string;
  shown: MenuItemInfo[];
  index: number;
}
const menuClose = StateEffect.define<null>();
const menuMove = StateEffect.define<number>();
/** `//` alone on a line, then anything but spaces and slashes (what the list is filtered by). */
const SLASH_LINE = /^\/\/([^\s/]*)$/;
const filterMenu = (items: MenuItemInfo[], query: string) => {
  const q = query.toLowerCase();
  return q ? items.filter((i) => `${i.name} ${i.plugin}`.toLowerCase().includes(q)) : items;
};

/**
 * The list that opens when `//` is typed alone on an empty line (Notion-style): one entry per thing a plugin can insert. Typing
 * more filters it, arrows + Enter / Tab or a tap choose, Escape or moving away closes it and leaves the typed text alone.
 * Choosing removes the typed text and asks the plugin what to put there.
 */
function slashMenu(getBlocks: () => BlockRenderer | null) {
  const pick = (view: EditorView, item: MenuItemInfo) => {
    const blocks = getBlocks();
    if (!blocks?.runInput) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const typed = line.text;
    view.dispatch({ changes: { from: line.from, to: line.to }, effects: menuClose.of(null), userEvent: "delete" });
    void blocks.runInput("item", { text: item.key }).then((out) => insertPluginText(view, line.from, line.from, out ?? typed));
  };

  const field = StateField.define<SlashMenu | null>({
    create: () => null,
    update(menu, tr) {
      const { state } = tr;
      const sel = state.selection.main;
      const line = state.doc.lineAt(sel.head);
      const match = sel.empty && sel.head === line.to ? SLASH_LINE.exec(line.text) : null;
      if (!match || tr.effects.some((e) => e.is(menuClose)) || state.facet(readingFacet)) return null;
      const query = match[1]!;
      if (menu) {
        if (menu.line !== line.from) return null;
        const shown = filterMenu(menu.items, query);
        if (shown.length === 0) return null;
        let index = query === menu.query ? Math.min(menu.index, shown.length - 1) : 0;
        for (const e of tr.effects) if (e.is(menuMove)) index = (index + e.value + shown.length) % shown.length;
        return { ...menu, query, shown, index };
      }
      if (query === "" && tr.docChanged && tr.isUserEvent("input.type") && !inCodeBlock(state, sel.head)) {
        const items = getBlocks()?.menuItems?.() ?? [];
        if (items.length > 0) return { line: line.from, items, query, shown: items, index: 0 };
      }
      return null;
    },
    provide: (f) =>
      showTooltip.compute([f], (state) => {
        const menu = state.field(f);
        return menu ? { pos: menu.line, above: false, strictSide: false, create } : null;
      }),
  });

  function create(view: EditorView): TooltipView {
    const dom = document.createElement("div");
    dom.className = "cm-slash-menu";
    const render = (state: EditorState) => {
      const menu = state.field(field);
      if (!menu) return;
      dom.replaceChildren(
        ...menu.shown.map((item, i) => {
          const row = document.createElement("div");
          row.className = i === menu.index ? "cm-slash-item cm-slash-on" : "cm-slash-item";
          const name = document.createElement("div");
          name.className = "cm-slash-name";
          name.textContent = item.name;
          row.append(name);
          if (item.description) {
            const desc = document.createElement("div");
            desc.className = "cm-slash-desc";
            desc.textContent = item.description;
            row.append(desc);
          }
          // pointerdown + preventDefault: the editor keeps focus (and the phone keeps its keyboard) while the entry is chosen.
          row.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            pick(view, item);
          });
          return row;
        }),
      );
      dom.querySelector(".cm-slash-on")?.scrollIntoView({ block: "nearest" });
    };
    render(view.state);
    return { dom, update: (u) => render(u.state) };
  }

  const move = (delta: number) => (view: EditorView) => {
    if (!view.state.field(field)) return false;
    view.dispatch({ effects: menuMove.of(delta) });
    return true;
  };
  const choose = (view: EditorView) => {
    const menu = view.state.field(field);
    if (!menu) return false;
    pick(view, menu.shown[menu.index]!);
    return true;
  };
  return [
    field,
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: move(1) },
        { key: "ArrowUp", run: move(-1) },
        { key: "Enter", run: choose },
        { key: "Tab", run: choose },
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(field)) return false;
            view.dispatch({ effects: menuClose.of(null) });
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      blur(_event, view) {
        if (view.state.field(field)) view.dispatch({ effects: menuClose.of(null) });
      },
    }),
  ];
}

const chipStyle = (chip: LinkChipInfo) => `--chip-icon:url("${chip.icon}");--chip-color:${chip.color}`;

/** A pasted address the editor offers to turn into a chip: `from`–`to` is the address in the note. `title` is null until the plugin has found one. */
interface ChipSuggestion {
  from: number;
  to: number;
  url: string;
  chip: LinkChipInfo;
  title: string | null;
}
const suggestSet = StateEffect.define<ChipSuggestion | null>();
const suggestTitle = StateEffect.define<{ url: string; title: string }>();

/** The address of the `[text](url)` link at `pos`, if that is what is there. */
function linkUrlAt(state: EditorState, pos: number): string | null {
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1);
  while (node && node.name !== "Link") node = node.parent;
  const url = node?.getChild("URL");
  return url ? state.sliceDoc(url.from, url.to) : null;
}

/**
 * Link chips (plugin API 5). Pasting a lone web address of a site a plugin knows leaves the address as text and shows
 * "Tab to replace with [chip]" above it (tap on a phone); Tab turns it into `[Title](url)`, which the live preview draws as a chip.
 * Anything else the user does (typing, moving the cursor, Escape) dismisses the offer. A click on a chip opens its address
 * (Ctrl/Cmd-click for any other link) through `openLink`, when the app gave one.
 */
function linkChips(getBlocks: () => BlockRenderer | null, getOpenLink: () => ((url: string) => void) | undefined) {
  const field = StateField.define<ChipSuggestion | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(suggestSet)) return e.value;
      if (!value) return null;
      const sel = tr.state.selection.main;
      if (tr.docChanged || !sel.empty || sel.head !== value.to) return null;
      for (const e of tr.effects) if (e.is(suggestTitle) && e.value.url === value.url) return { ...value, title: e.value.title };
      return value;
    },
    provide: (f) =>
      showTooltip.compute([f], (state) => {
        const v = state.field(f);
        return v ? { pos: v.from, above: true, strictSide: false, create } : null;
      }),
  });

  const accept = (view: EditorView): boolean => {
    const v = view.state.field(field);
    if (!v) return false;
    const title = (v.title ?? v.chip.label).replace(/\s+/g, " ").trim() || v.chip.label;
    const text = `[${title.replace(/[[\]\\]/g, "\\$&")}](${v.url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
    view.dispatch({ changes: { from: v.from, to: v.to, insert: text }, selection: { anchor: v.from + text.length }, userEvent: "input.plugin" });
    return true;
  };

  function create(view: EditorView): TooltipView {
    const dom = document.createElement("div");
    dom.className = "cm-chip-suggest";
    const key = document.createElement("kbd");
    key.textContent = window.matchMedia?.("(pointer: coarse)").matches ? "tap" : "tab";
    const to = document.createElement("span");
    to.textContent = "to replace with";
    const chip = document.createElement("span");
    chip.className = "cm-chip";
    dom.append(key, to, chip);
    const render = (state: EditorState) => {
      const v = state.field(field);
      if (!v) return;
      chip.setAttribute("style", chipStyle(v.chip));
      chip.textContent = v.title ?? v.chip.label;
    };
    render(view.state);
    // pointerdown + preventDefault: the editor keeps focus (and the phone its keyboard) while the offer is taken.
    dom.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      accept(view);
    });
    return { dom, update: (u) => render(u.state) };
  }

  return [
    field,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: accept },
        {
          // The cursor right after a chip: Backspace removes the whole chip (its hidden `](url)` would otherwise be eaten one character at a time).
          key: "Backspace",
          run: (view) => {
            const { head, empty } = view.state.selection.main;
            if (!empty) return false;
            let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(head, -1);
            while (node && node.name !== "Link") node = node.parent;
            const url = node?.getChild("URL");
            if (!node || node.to !== head || !url || !getBlocks()?.linkChip?.(view.state.sliceDoc(url.from, url.to))) return false;
            view.dispatch({ changes: { from: node.from, to: node.to }, userEvent: "delete.backward" });
            return true;
          },
        },
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(field)) return false;
            view.dispatch({ effects: suggestSet.of(null) });
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      paste(event, view) {
        const blocks = getBlocks();
        const text = (event.clipboardData?.getData("text/plain") ?? "").trim();
        if (!blocks?.linkChip || !blocks.runInput || !/^https?:\/\/[^\s<>"]+$/i.test(text) || view.state.facet(readingFacet)) return false;
        const { from, to } = view.state.selection.main;
        const chip = blocks.linkChip(text);
        if (!chip || inCodeBlock(view.state, from)) return false;
        event.preventDefault();
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          effects: suggestSet.of({ from, to: from + text.length, url: text, chip, title: null }),
          userEvent: "input.paste",
        });
        void blocks.runInput("link", { text: chip.key, url: text }).then((title) => {
          if (title?.trim() && view.dom.isConnected) view.dispatch({ effects: suggestTitle.of({ url: text, title: title.trim().slice(0, 200) }) });
        });
        return true;
      },
      click(event, view) {
        const el = event.target instanceof Element ? event.target.closest(".cm-chip, .cm-link") : null;
        const open = getOpenLink();
        if (!el || !open || !view.state.selection.main.empty || (!el.classList.contains("cm-chip") && !(event.metaKey || event.ctrlKey))) return false;
        const url = linkUrlAt(view.state, view.posAtDOM(el));
        if (!url || !/^https?:\/\//i.test(url)) return false;
        open(url);
        return true;
      },
    }),
  ];
}

/** From the opening fence line at `pos`: the whole block and the text between its fences (`empty` when there is none). */
function fenceRanges(doc: Text, pos: number) {
  const open = doc.lineAt(pos);
  for (let n = open.number + 1; n <= doc.lines; n++) {
    const close = doc.line(n);
    if (!/^\s*(`{3,}|~{3,})\s*$/.test(close.text)) continue;
    const empty = n === open.number + 1;
    const inner = empty ? { from: close.from, to: close.from } : { from: doc.line(open.number + 1).from, to: doc.line(n - 1).to };
    return { whole: { from: open.from, to: close.to }, inner, empty };
  }
  return null;
}

/**
 * Backspace next to a plugin block must not eat its hidden closing ``` (the block would suddenly turn into raw text).
 * At the block's end, or at the start of the line after it, the first Backspace selects the block, which shows its text
 * highlighted; a second one deletes it, like an image. An empty line after it (not the note's last) is simply removed.
 */
function backspaceAfterBlock(view: EditorView, blocks: BlockRenderer | null): boolean {
  const { state } = view;
  const { doc } = state;
  const sel = state.selection.main;
  if (!blocks || !sel.empty) return false;
  const line = doc.lineAt(sel.head);
  const below = sel.head === line.from && line.number > 1;
  const fence = below ? doc.line(line.number - 1) : sel.head === line.to ? line : null;
  if (!fence) return false;
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(fence.to, -1);
  while (node && node.name !== "FencedCode") node = node.parent;
  if (!node || node.to !== fence.to || node.getChildren("CodeMark").length < 2) return false;
  const info = node.getChild("CodeInfo");
  const lang = info ? state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0]! : "";
  if (!lang || !blocks.langs().includes(lang)) return false;
  if (below && line.length === 0 && line.number < doc.lines) {
    view.dispatch({ changes: { from: line.from, to: line.from + 1 }, userEvent: "delete.backward" });
  } else {
    view.dispatch({ selection: { anchor: doc.lineAt(node.from).from, head: fence.to }, scrollIntoView: true });
  }
  return true;
}

/** A plugin block: the plugin's own page, in a sandboxed frame, in the flow of the note. */
class BlockWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly source: string,
    readonly renderer: BlockRenderer,
  ) {
    super();
  }
  eq(o: BlockWidget) {
    return o.lang === this.lang && o.source === this.source && o.renderer === this.renderer;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-plugin-block";
    el.dataset.lang = this.lang;
    try {
      blockMounts.set(
        el,
        this.renderer.mount(this.lang, el, this.source, {
          save: (text) => this.write(view, el, text),
          remove: () => this.write(view, el, null),
          edit: () => {
            const found = fenceRanges(view.state.doc, view.posAtDOM(el));
            if (!found) return;
            view.dispatch({ selection: { anchor: found.inner.from }, scrollIntoView: true });
            view.focus();
          },
        }),
      );
    } catch (e) {
      el.textContent = e instanceof Error ? e.message : String(e);
    }
    return el;
  }
  /** Keep the frame (and what is typed in it) when the note's text changes; the frame ignores its own echoes. */
  updateDOM(dom: HTMLElement) {
    const mount = blockMounts.get(dom);
    // A frame runs one plugin: a block of another language (another note's calendar where a table was) needs its own.
    if (!mount || dom.dataset.lang !== this.lang) return false;
    mount.update(this.source);
    return true;
  }
  destroy(dom: HTMLElement) {
    blockMounts.get(dom)?.destroy();
    blockMounts.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 200;
  }
  private write(view: EditorView, dom: HTMLElement, text: string | null) {
    const { doc } = view.state;
    const found = fenceRanges(doc, view.posAtDOM(dom));
    if (!found) return;
    const changes =
      text === null
        ? { from: found.whole.from, to: Math.min(found.whole.to + 1, doc.length), insert: "" }
        : found.empty
          ? { from: found.inner.from, insert: `${text}\n` }
          : { from: found.inner.from, to: found.inner.to, insert: text };
    view.dispatch({ changes, userEvent: "input.plugin" });
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly enterPos: number,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.enterPos === this.enterPos;
  }
  toDOM(view: EditorView) {
    const [head, delim, ...body] = this.source.split("\n");
    const align = splitRow(delim ?? "").map((c) => (/^:-*:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "left"));
    const table = document.createElement("table");
    table.className = "cm-table";
    const addRow = (line: string, tag: "th" | "td", parent: HTMLElement) => {
      const tr = document.createElement("tr");
      splitRow(line).forEach((cell, i) => {
        const el = document.createElement(tag);
        el.style.textAlign = align[i] ?? "left";
        renderInline(cell, el);
        tr.append(el);
      });
      parent.append(tr);
    };
    const thead = table.createTHead();
    addRow(head ?? "", "th", thead);
    const tbody = table.createTBody();
    for (const line of body) if (line.trim()) addRow(line, "td", tbody);
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";
    wrap.append(table);
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.enterPos } });
      view.focus();
    });
    return wrap;
  }
}

/** Zero-width vertical bar (like a text cursor) showing where a dragged-in file will land. */
class DropCaretWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-drop-caret";
    return el;
  }
}

const setDrop = StateEffect.define<number | null>();
const dropField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDrop)) continue;
      return e.value == null ? Decoration.none : Decoration.set([Decoration.widget({ widget: new DropCaretWidget() }).range(e.value)]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Where an insert lands. `exact` means it is the precise character under the drop
 * point (insert inline, like a text cursor); otherwise it is the cursor / end of
 * the note and the caller should insert as its own paragraph.
 */
function insertPoint(view: EditorView, at?: { x: number; y: number }): { pos: number; exact: boolean } {
  const { state } = view;
  const dropPos = at ? view.posAtCoords(at) : null;
  let pos = dropPos ?? (view.hasFocus ? state.selection.main.head : state.doc.length);
  let exact = dropPos != null;
  const fm = frontmatterRange(state);
  if (fm && pos <= fm.to) {
    pos = Math.min(fm.to + 1, state.doc.length);
    exact = false;
  }
  return { pos, exact };
}

const HIDE = Decoration.replace({});
const lineDeco = (cls: string) => Decoration.line({ class: cls });
const markDeco = (cls: string) => Decoration.mark({ class: cls });
const chipDeco = (chip: LinkChipInfo) => Decoration.mark({ class: "cm-link cm-chip", attributes: { style: chipStyle(chip) } });

const HEADING = /^ATXHeading([1-6])$/;

function resolveImageSrc(src: string, baseDir: string, toUrl: (path: string) => string): string {
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  try {
    return toUrl(join(baseDir, src));
  } catch {
    return src;
  }
}

/** Returns [from, to] of the leading `---` frontmatter block, or null. */
function frontmatterRange(state: EditorState): { to: number; rows: [string, string][] } | null {
  const { doc } = state;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  const rows: [string, string][] = [];
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trimEnd() === "---") return { to: line.to, rows };
    const m = /^([^:\s][^:]*):\s*(.*)$/.exec(line.text);
    if (m) rows.push([m[1]!.trim(), m[2]!.trim()]);
    else if (rows.length && line.text.trim()) rows[rows.length - 1]![1] += ` ${line.text.trim()}`;
  }
  return null;
}

const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

function inInlineCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "InlineCode") return true;
  }
  return false;
}

/** Underline is not Markdown, so it is written `<u>text</u>`. */
const UNDERLINE = /<u>[^<\n]+<\/u>/g;

function inCodeBlock(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

/**
 * Finds GFM tables (header row, `---|---` delimiter row, body rows) by scanning
 * lines. The Markdown parser can't be trusted here: a `---` directly under the
 * last row makes it read the whole table as a heading. `ruleLine` is that `---`.
 */
function findTables(state: EditorState, fromLine: number) {
  const { doc } = state;
  const tables: { first: number; last: number; from: number; to: number; ruleLine: number | null }[] = [];
  for (let n = fromLine; n < doc.lines; n++) {
    const head = doc.line(n).text;
    const delim = doc.line(n + 1).text;
    if (!head.includes("|") || !delim.includes("|") || !TABLE_DELIM.test(delim)) continue;
    if (splitRow(head).length !== splitRow(delim).length || inCodeBlock(state, doc.line(n).from)) continue;
    let last = n + 1;
    while (last < doc.lines && doc.line(last + 1).text.trim() && doc.line(last + 1).text.includes("|")) last++;
    const ruleLine = last < doc.lines && RULE.test(doc.line(last + 1).text) ? last + 1 : null;
    tables.push({ first: n, last, from: doc.line(n).from, to: doc.line(last).to, ruleLine });
    n = last;
  }
  return tables;
}

/** Editor-external lookups the decorations need. */
interface PreviewContext {
  getBaseDir: () => string;
  /** Absolute path of the vault image called `name` (Obsidian `![[name]]` embeds), if any. */
  resolveEmbed: (name: string) => string | null;
  /** Turns a file path into a URL the page can load (Tauri's asset protocol, a `file://` URI, …). */
  toUrl: (path: string) => string;
  /** Plugin block renderer, when the app has one. */
  getBlocks: () => BlockRenderer | null;
}

/** `![[image.png]]` / `![[image.png|300]]` embeds whose image can be found in the vault. */
function findEmbeds(state: EditorState, fromLine: number, ctx: PreviewContext) {
  const { doc } = state;
  const found: { from: number; to: number; src: string; name: string; width: number | null; sizeFrom: number; sizeTo: number }[] = [];
  for (let n = fromLine; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("![[")) continue;
    for (const m of line.text.matchAll(/!\[\[([^\]\n]+?)\]\]/g)) {
      const inner = m[1]!;
      const { base, width } = splitSize(inner);
      if (!IMAGE_FILE.test(base)) continue;
      const abs = ctx.resolveEmbed(base.trim());
      const from = line.from + m.index!;
      if (!abs || inCodeBlock(state, from)) continue;
      found.push({
        from,
        to: from + m[0].length,
        src: resolveImageSrc(abs, "", ctx.toUrl),
        name: base,
        width,
        sizeFrom: from + 3,
        sizeTo: from + 3 + inner.length,
      });
    }
  }
  return found;
}

function buildDecorations(state: EditorState, ctx: PreviewContext): DecorationSet {
  const { doc } = state;
  // Reading mode shows every line rendered, as if the cursor were nowhere.
  const ranges = state.facet(readingFacet) ? [] : state.selection.ranges;
  const out: Range<Decoration>[] = [];

  const activeLines = new Set<number>();
  for (const r of ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n);
  }
  const onActiveLine = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
  /** The cursor is strictly inside (or a selection covers it): a cursor at an edge does not open a chip's markup. */
  const within = (from: number, to: number) => ranges.some((r) => r.from < to && r.to > from);
  const hide = (from: number, to: number) => {
    if (to > from) out.push(HIDE.range(from, to));
  };

  // Frontmatter: properties box unless the cursor is inside it.
  const fm = frontmatterRange(state);
  let skipBefore = 0;
  if (fm) {
    skipBefore = fm.to;
    const editing = ranges.some((r) => r.from < fm.to && r.to > 0);
    if (editing) {
      for (let n = 1; n <= doc.lineAt(fm.to).number; n++) {
        out.push(lineDeco("cm-fm-line").range(doc.line(n).from));
      }
    } else {
      out.push(
        Decoration.replace({
          widget: new FrontmatterWidget(fm.rows, doc.line(2).from),
          block: true,
        }).range(0, fm.to),
      );
    }
  }

  const tables = findTables(state, fm ? doc.lineAt(fm.to).number + 1 : 1);
  for (const t of tables) {
    // Raw while the cursor is inside the table. The very end of the last row doesn't count, so a
    // freshly pasted table (cursor left right after it) shows rendered, and typing a new last row keeps it live.
    const editing = ranges.some((r) => r.from < t.to && (r.to > t.from || r.from === t.from));
    if (editing) {
      for (let n = t.first; n <= t.last; n++) out.push(lineDeco("cm-table-line").range(doc.line(n).from));
    } else {
      out.push(
        Decoration.replace({ widget: new TableWidget(doc.sliceString(t.from, t.to), t.from), block: true }).range(t.from, t.to),
      );
    }
    if (t.ruleLine != null) {
      const rule = doc.line(t.ruleLine);
      out.push(lineDeco("cm-hr").range(rule.from));
      if (!onActiveLine(rule.from)) out.push(markDeco("cm-hr-text").range(rule.from, rule.to));
    }
  }
  const inTable = (from: number, to: number) => tables.some((t) => from >= t.from && to <= (t.ruleLine != null ? doc.line(t.ruleLine).to : t.to));

  const sel = state.field(selectedField);
  const embeds = findEmbeds(state, fm ? doc.lineAt(fm.to).number + 1 : 1, ctx);
  for (const e of embeds) {
    if (touches(e.from, e.to)) continue;
    out.push(
      Decoration.replace({
        widget: new ImageWidget({
          src: e.src, alt: e.name, width: e.width, from: e.from, to: e.to,
          sizeFrom: e.sizeFrom, sizeTo: e.sizeTo, base: e.name, selected: sel?.from === e.from && sel.to === e.to,
        }),
      }).range(e.from, e.to),
    );
  }
  const inEmbed = (from: number, to: number) => embeds.some((e) => from >= e.from && to <= e.to);

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from < skipBefore) return node.to <= skipBefore ? false : undefined;
      if (inTable(node.from, node.to) || inEmbed(node.from, node.to)) return false;
      const name = node.name;

      const heading = HEADING.exec(name);
      if (heading) {
        out.push(lineDeco(`cm-h cm-h${heading[1]}`).range(doc.lineAt(node.from).from));
        if (!onActiveLine(node.from)) {
          const mark = node.node.getChild("HeaderMark");
          if (mark) hide(mark.from, Math.min(mark.to + 1, node.to));
        }
        return;
      }

      switch (name) {
        case "StrongEmphasis":
        case "Emphasis":
        case "Strikethrough":
        case "InlineCode": {
          const cls =
            name === "StrongEmphasis" ? "cm-strong" : name === "Emphasis" ? "cm-em" : name === "Strikethrough" ? "cm-strike" : "cm-inline-code";
          out.push(markDeco(cls).range(node.from, node.to));
          if (!touches(node.from, node.to)) {
            for (const child of node.node.getChildren(name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark")) {
              hide(child.from, child.to);
            }
          }
          return;
        }
        case "Link": {
          const marks = node.node.getChildren("LinkMark");
          if (marks.length >= 2) {
            const url = node.node.getChild("URL");
            const chip = url && marks[0]!.to < marks[1]!.from ? ctx.getBlocks()?.linkChip?.(doc.sliceString(url.from, url.to)) : null;
            out.push((chip ? chipDeco(chip) : markDeco("cm-link")).range(marks[0]!.to, marks[1]!.from));
            if (!(chip ? within : touches)(node.from, node.to)) {
              hide(marks[0]!.from, marks[0]!.to);
              hide(marks[1]!.from, node.to);
            }
          }
          return false;
        }
        case "Image": {
          if (touches(node.from, node.to)) return false;
          const url = node.node.getChild("URL");
          if (!url) return false;
          const marks = node.node.getChildren("LinkMark");
          if (marks.length < 2) return false;
          const altFrom = marks[0]!.to;
          const altTo = marks[1]!.from;
          const { base, width } = splitSize(doc.sliceString(altFrom, altTo));
          const src = resolveImageSrc(doc.sliceString(url.from, url.to), ctx.getBaseDir(), ctx.toUrl);
          out.push(
            Decoration.replace({
              widget: new ImageWidget({
                src, alt: base, width, from: node.from, to: node.to, sizeFrom: altFrom, sizeTo: altTo, base,
                selected: sel?.from === node.from && sel.to === node.to,
              }),
            }).range(node.from, node.to),
          );
          return false;
        }
        case "ListMark": {
          const text = doc.sliceString(node.from, node.to);
          if (/^[-*+]$/.test(text) && !touches(node.from, node.to)) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          if (node.from === doc.lineAt(node.from).from) out.push(lineDeco("cm-li").range(node.from));
          return;
        }
        case "Blockquote": {
          const last = doc.lineAt(node.to).number;
          for (let n = doc.lineAt(node.from).number; n <= last; n++) {
            out.push(lineDeco("cm-quote").range(doc.line(n).from));
          }
          return;
        }
        case "QuoteMark": {
          if (!onActiveLine(node.from)) {
            const next = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            hide(node.from, next);
          }
          return;
        }
        case "FencedCode": {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          const renderer = ctx.getBlocks();
          const info = node.node.getChild("CodeInfo");
          const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0]! : "";
          if (renderer && lang && node.node.getChildren("CodeMark").length >= 2 && renderer.langs().includes(lang)) {
            const start = doc.line(first);
            const end = doc.line(last);
            // Plain text while the cursor is inside it (to edit or delete it), like a table. A cursor on the block's edge
            // does not count: a note opens with the cursor at 0, which is the start of a sheet that is the whole page.
            if (!ranges.some((r) => r.from < end.to && r.to > start.from)) {
              const text = node.node.getChild("CodeText");
              const widget = new BlockWidget(lang, text ? doc.sliceString(text.from, text.to) : "", renderer);
              out.push(Decoration.replace({ widget, block: true }).range(start.from, end.to));
              return false;
            }
          }
          for (let n = first; n <= last; n++) {
            const cls = n === first ? "cm-codeblock cm-codeblock-first" : n === last ? "cm-codeblock cm-codeblock-last" : "cm-codeblock";
            out.push(lineDeco(cls).range(doc.line(n).from));
          }
          return false;
        }
        case "HorizontalRule": {
          const line = doc.lineAt(node.from);
          out.push(lineDeco("cm-hr").range(line.from));
          if (!onActiveLine(node.from)) out.push(markDeco("cm-hr-text").range(node.from, node.to));
          return false;
        }
      }
    },
  });

  // Underlined text: the tags hide unless the cursor is on them, like the other markers.
  for (let n = fm ? doc.lineAt(fm.to).number + 1 : 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("<u>")) continue;
    for (const m of line.text.matchAll(UNDERLINE)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (inTable(from, to) || inEmbed(from, to) || inCodeBlock(state, from) || inInlineCode(state, from)) continue;
      out.push(markDeco("cm-underline").range(from + 3, to - 4));
      if (!touches(from, to)) {
        hide(from, from + 3);
        hide(to - 4, to);
      }
    }
  }

  // Indent guide: one thin bar just left of an indented line's text (on its last indent step, a tab or two spaces).
  // Lines indented alike form one continuous bar, and the bar steps in or out as the indent changes, so deep nesting
  // stays a single quiet line instead of a comb. Painted on the whitespace itself, so it follows the text in any font.
  for (let n = fm ? doc.lineAt(fm.to).number + 1 : 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const lead = /^[ \t]+/.exec(line.text);
    if (!lead || lead[0].length === line.text.length || inTable(line.from, line.to) || inEmbed(line.from, line.to)) continue;
    // On the last tab (spaces after a tab only line text up, so they don't move the bar), else on the last two spaces.
    const tab = lead[0].lastIndexOf("\t");
    const at = tab >= 0 ? tab : lead[0].length >= 2 ? lead[0].length - 2 : -1;
    if (at >= 0) out.push(markDeco("cm-indent-guide").range(line.from + at, line.from + at + (tab >= 0 ? 1 : 2)));
  }

  return Decoration.set(out, true);
}

function livePreview(ctx: PreviewContext) {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, ctx),
    update(deco, tr) {
      // The parser works in the background, so also rebuild when it has caught up (a long note would stay half-styled).
      if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) || tr.effects.some((e) => e.is(refresh) || e.is(setSel))) {
        return buildDecorations(tr.state, ctx);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return field;
}

/** Wrap / unwrap the selection (or the word at the cursor) in bold, italic, strikethrough or underline markers. */
function applyFormat(view: EditorView, format: InlineFormat): boolean {
  const { from, to } = view.state.selection.main;
  const edit = toggleFormat(view.state.doc.toString(), from, to, format);
  view.dispatch({
    changes: edit.changes,
    selection: EditorSelection.range(edit.selection.anchor, edit.selection.head),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

export interface LiveEditorHandle {
  /** Toggle bold / italic / strikethrough / underline on the selection (the phone's format bar uses this). */
  format(kind: InlineFormat): void;
  /**
   * Insert Markdown. Given `at` (viewport coordinates inside the editor) it goes
   * inline at exactly that character, like a text cursor; otherwise it becomes
   * its own paragraph at the cursor (if focused) or the end. Never lands inside
   * the frontmatter.
   */
  insertBlock(text: string, at?: { x: number; y: number }): void;
  /** Show (or with null, hide) a caret where a file dragged to `at` would be inserted. */
  showDropIndicator(at: { x: number; y: number } | null): void;
  /** The whole note as it is in the editor right now. */
  getText(): string;
  /** The selected text, or "" when nothing is selected. */
  getSelection(): string;
  /** Replace the selection, or insert at the cursor when nothing is selected (used by plugins). */
  replaceSelection(text: string): void;
  /** Replace the whole note (one undo step). The cursor goes to the end, outside any plugin block. */
  setText(text: string): void;
  /** A plugin's live session with this editor (plugin API 6): see `SyncPort`. It ends when another note is opened here. */
  sync: SyncPort;
}

export interface LiveEditorProps {
  ref?: Ref<LiveEditorHandle>;
  /**
   * The note's name, shown as an editable heading above the text. It is part of the editor (not of the app around it)
   * so a theme or plugin that restyles the editor restyles it too. `onRename` resolves false if it didn't happen.
   */
  title?: { name: string; onRename: (title: string) => Promise<boolean> };
  /** Reading mode: the note can be read, scrolled and copied from, but not edited. Plugin blocks stay usable. */
  readOnly?: boolean;
  value: string;
  /** Vault images by lower-cased file name, for resolving Obsidian `![[name.png]]` embeds. */
  embeds: ReadonlyMap<string, string>;
  /** Path of the open note; relative image links resolve against its folder. */
  notePath: string | null;
  /** Turns a file path into a URL the page can load: Tauri's asset protocol on desktop, `file://` on phones. */
  toUrl: (path: string) => string;
  /** Draws the fenced blocks plugins have registered (a spreadsheet, say) in place. */
  blocks?: BlockRenderer;
  /** Open a web address in the system browser (a click on a link chip). Without it, links stay text. */
  onOpenLink?: (url: string) => void;
  /** The text changed by typing or a plugin block. `notePath` is the note that editor belongs to (it can differ from the one showing: a hidden editor's plugin may still save). */
  onChange: (value: string, notePath?: string) => void;
}

export default function LiveEditor({ ref, title, readOnly = false, value, embeds, notePath, toUrl, blocks, onOpenLink, onChange }: LiveEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readingRef = useRef(new Compartment());
  const syncRef = useRef<SyncSession | null>(null);
  const onChangeRef = useRef(onChange);
  const baseDirRef = useRef("");
  const prevPath = useRef(notePath);
  const embedsRef = useRef(embeds);
  embedsRef.current = embeds;
  const toUrlRef = useRef(toUrl);
  toUrlRef.current = toUrl;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const openLinkRef = useRef(onOpenLink);
  openLinkRef.current = onOpenLink;
  onChangeRef.current = onChange;
  baseDirRef.current = notePath ? dirname(notePath) : "";

  /** Editors kept alive, most recently shown last: going back to a note finds its plugin blocks still drawn, not loading again. */
  const views = useRef(new Map<string, { view: EditorView; stopResize: () => void }>());
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const makeView = (path: string, doc: string) => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          readingRef.current.of(readingMode(readOnlyRef.current)),
          history(),
          selectedField,
          keymap.of([
            { key: "Mod-b", run: (v) => applyFormat(v, "bold") },
            { key: "Mod-i", run: (v) => applyFormat(v, "italic") },
            { key: "Mod-u", run: (v) => applyFormat(v, "underline") },
            { key: "Mod-Shift-x", run: (v) => applyFormat(v, "strike") },
            {
              key: "Escape",
              run: (v) => {
                if (!v.state.field(selectedField)) return false;
                v.dispatch({ effects: setSel.of(null) });
                return true;
              },
            },
            ...(["Backspace", "Delete"] as const).map((key) => ({
              key,
              run: (v: EditorView) => {
                const sel = v.state.field(selectedField);
                if (!sel) return false;
                v.dispatch({ changes: imageRemoval(v.state.doc, sel.from, sel.to), effects: setSel.of(null) });
                return true;
              },
            })),
            { key: "Backspace", run: (v) => backspaceAfterBlock(v, blocksRef.current ?? null) },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of("  "),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          // Like Obsidian: the last line can be scrolled up to the top, and typing near the end keeps the caret
          // out of the bottom third instead of pinning it to the bottom edge (hard to read, and under the phone's keyboard bar).
          scrollPastEnd(),
          EditorView.scrollMargins.of((view) => ({ bottom: view.dom.clientHeight * 0.3 })),
          placeholder("Start writing markdown…"),
          livePreview({
            getBaseDir: () => baseDirRef.current,
            resolveEmbed: (name) => embedsRef.current.get(name.toLowerCase()) ?? null,
            toUrl: (path) => toUrlRef.current(path),
            getBlocks: () => blocksRef.current ?? null,
          }),
          dropField,
          pluginInput(() => blocksRef.current ?? null),
          slashMenu(() => blocksRef.current ?? null),
          linkChips(() => blocksRef.current ?? null, () => openLinkRef.current),
          remoteCursors,
          EditorView.updateListener.of((u) => {
            syncRef.current?.update(u);
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) {
              // The note this editor belongs to: a hidden editor's plugin block can still save after another note was shown.
              onChangeRef.current(u.state.doc.toString(), path === "" ? undefined : path);
            }
          }),
        ],
      }),
    });
    // A plugin block that is the whole page is as tall as the editor: publish that height as a CSS variable (a hidden editor has none).
    const resize = new ResizeObserver(() => {
      if (view.scrollDOM.clientHeight > 0) host.current?.style.setProperty("--editor-h", `${view.scrollDOM.clientHeight}px`);
    });
    resize.observe(view.scrollDOM);
    views.current.set(path, { view, stopResize: () => resize.disconnect() });
    return view;
  };

  /** Show the editor of `path` (making it if it is new) and hide the others; the least recently shown ones are dropped. */
  const showView = (path: string, doc: string) => {
    const map = views.current;
    const entry = map.get(path);
    map.delete(path);
    const view = entry?.view ?? makeView(path, doc);
    if (entry) map.set(path, entry);
    // CodeMirror sets `display: flex !important` on its root, so hiding needs an important of its own.
    for (const [key, other] of map) {
      if (key === path) other.view.dom.style.removeProperty("display");
      else other.view.dom.style.setProperty("display", "none", "important");
    }
    for (const [key, old] of map) {
      if (map.size <= MAX_KEPT_EDITORS) break;
      if (key === path) continue;
      old.stopResize();
      old.view.destroy();
      map.delete(key);
    }
    viewRef.current = view;
    view.requestMeasure();
  };

  useEffect(() => {
    showView(notePath ?? "", value);
    return () => {
      syncRef.current?.end("the editor was closed");
      syncRef.current = null;
      for (const { view, stopResize } of views.current.values()) {
        stopResize();
        view.destroy();
      }
      views.current.clear();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      insertBlock(text, at) {
        const view = viewRef.current;
        if (!view) return;
        const { state } = view;
        const { pos, exact } = insertPoint(view, at);
        let insert = text;
        if (!exact) {
          const before = state.sliceDoc(Math.max(0, pos - 2), pos);
          const after = state.sliceDoc(pos, pos + 1);
          const lead = pos === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
          const trail = after === "" || after === "\n" ? "\n" : "\n\n";
          insert = lead + text + trail;
        }
        view.dispatch({
          changes: { from: pos, insert },
          selection: { anchor: pos + insert.length },
          scrollIntoView: true,
        });
        view.focus();
      },
      format(kind) {
        const view = viewRef.current;
        if (!view) return;
        applyFormat(view, kind);
        view.focus();
      },
      getText: () => viewRef.current?.state.doc.toString() ?? "",
      getSelection() {
        const state = viewRef.current?.state;
        return state ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : "";
      },
      replaceSelection(text) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.plugin" });
        view.focus();
      },
      setText(text) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: text.length },
          userEvent: "input.plugin",
        });
      },
      sync: {
        start(listener) {
          const view = viewRef.current;
          if (!view) throw new Error("the editor is not ready");
          syncRef.current?.end("another live session started");
          syncRef.current = new SyncSession(view, listener);
          return view.state.doc.toString();
        },
        stop() {
          syncRef.current?.clear();
          syncRef.current = null;
        },
        remote(changes) {
          const session = syncRef.current;
          if (!session) throw new Error("no live session");
          try {
            session.remote(changes);
          } catch (e) {
            syncRef.current = null;
            session.end(e instanceof Error ? e.message : String(e));
            throw e;
          }
        },
        ack() {
          const session = syncRef.current;
          if (!session) throw new Error("no live session");
          try {
            session.ack();
          } catch (e) {
            syncRef.current = null;
            session.end(e instanceof Error ? e.message : String(e));
            throw e;
          }
        },
        setCursors(cursors) {
          syncRef.current?.setCursors(cursors);
        },
      },
      showDropIndicator(at) {
        const view = viewRef.current;
        if (!view) return;
        const pos = at && view.posAtCoords(at) != null ? insertPoint(view, at).pos : null;
        view.dispatch({ effects: setDrop.of(pos) });
      },
    }),
    [],
  );

  // Sync text that changed outside the editor (opening a note, inserting an image, sync).
  useEffect(() => {
    if (prevPath.current !== notePath) {
      syncRef.current?.end("another note was opened");
      syncRef.current = null;
      showView(notePath ?? "", value);
    }
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      // Replace only what differs, so the caret and scroll of a note that is also being edited in another pane stay put.
      let from = 0;
      const shared = Math.min(current.length, value.length);
      while (from < shared && current.charCodeAt(from) === value.charCodeAt(from)) from++;
      let endCurrent = current.length;
      let endValue = value.length;
      while (endCurrent > from && endValue > from && current.charCodeAt(endCurrent - 1) === value.charCodeAt(endValue - 1)) {
        endCurrent--;
        endValue--;
      }
      view.dispatch({
        changes: { from, to: endCurrent, insert: value.slice(from, endValue) },
        // A different note starts at the top; the same note keeps the (mapped) cursor.
        ...(prevPath.current !== notePath ? { selection: { anchor: 0 } } : {}),
        annotations: [External.of(true), Transaction.addToHistory.of(false)],
      });
    } else if (prevPath.current !== notePath) {
      view.dispatch({ effects: refresh.of(null) });
    }
    prevPath.current = notePath;
  }, [value, notePath]);

  useEffect(() => {
    for (const { view } of views.current.values()) view.dispatch({ effects: [readingRef.current.reconfigure(readingMode(readOnly)), refresh.of(null)] });
  }, [readOnly]);

  // Vault images were (re)indexed: re-resolve any `![[name.png]]` embeds.
  useEffect(() => {
    for (const { view } of views.current.values()) view.dispatch({ effects: refresh.of(null) });
  }, [embeds]);

  // A plugin started or stopped drawing a kind of block.
  useEffect(() => {
    const redraw = () => views.current.forEach(({ view }) => view.dispatch({ effects: refresh.of(null) }));
    redraw();
    return blocks?.subscribe(redraw);
  }, [blocks]);

  return (
    <div className="live-editor">
      {title && <NoteTitle key={notePath} name={title.name} onRename={title.onRename} readOnly={readOnly} />}
      <div className="live-editor-host" ref={host} />
    </div>
  );
}

// The EditorView is built once per mount, so a hot-swapped module would leave the old
// extensions running (stale decorations, stale drop handling). Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
