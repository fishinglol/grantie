/// <reference types="vite/client" />
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  Annotation,
  EditorState,
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
  WidgetType,
} from "@codemirror/view";
import { dirname, IMAGE_FILE, join } from "@granite/core-notes";
import { openImageViewer } from "./imageViewer";

export { IMAGE_FILE };

/**
 * Obsidian-style "live preview" editor: the document stays plain Markdown, but
 * syntax is styled in place and markers (#, **, [](), ---) are hidden on every
 * line except the one the cursor is on.
 */

const External = Annotation.define<boolean>();
const refresh = StateEffect.define<null>();

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
  const { doc, selection } = state;
  const out: Range<Decoration>[] = [];

  const activeLines = new Set<number>();
  for (const r of selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n);
  }
  const onActiveLine = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  const touches = (from: number, to: number) => selection.ranges.some((r) => r.from <= to && r.to >= from);
  const hide = (from: number, to: number) => {
    if (to > from) out.push(HIDE.range(from, to));
  };

  // Frontmatter: properties box unless the cursor is inside it.
  const fm = frontmatterRange(state);
  let skipBefore = 0;
  if (fm) {
    skipBefore = fm.to;
    const editing = selection.ranges.some((r) => r.from < fm.to && r.to > 0);
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
    const editing = selection.ranges.some((r) => r.from < t.to && (r.to > t.from || r.from === t.from));
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
            out.push(markDeco("cm-link").range(marks[0]!.to, marks[1]!.from));
            if (!touches(node.from, node.to)) {
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

  return Decoration.set(out, true);
}

function livePreview(ctx: PreviewContext) {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, ctx),
    update(deco, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refresh) || e.is(setSel))) {
        return buildDecorations(tr.state, ctx);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return field;
}

export interface LiveEditorHandle {
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
}

export interface LiveEditorProps {
  ref?: Ref<LiveEditorHandle>;
  value: string;
  /** Vault images by lower-cased file name, for resolving Obsidian `![[name.png]]` embeds. */
  embeds: ReadonlyMap<string, string>;
  /** Path of the open note; relative image links resolve against its folder. */
  notePath: string | null;
  /** Turns a file path into a URL the page can load: Tauri's asset protocol on desktop, `file://` on phones. */
  toUrl: (path: string) => string;
  onChange: (value: string) => void;
}

export default function LiveEditor({ ref, value, embeds, notePath, toUrl, onChange }: LiveEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const baseDirRef = useRef("");
  const prevPath = useRef(notePath);
  const embedsRef = useRef(embeds);
  embedsRef.current = embeds;
  const toUrlRef = useRef(toUrl);
  toUrlRef.current = toUrl;
  onChangeRef.current = onChange;
  baseDirRef.current = notePath ? dirname(notePath) : "";

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          selectedField,
          keymap.of([
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
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of("  "),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          placeholder("Start writing markdown…"),
          livePreview({
            getBaseDir: () => baseDirRef.current,
            resolveEmbed: (name) => embedsRef.current.get(name.toLowerCase()) ?? null,
            toUrl: (path) => toUrlRef.current(path),
          }),
          dropField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) {
              onChangeRef.current(u.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
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
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: 0 },
        annotations: [External.of(true), Transaction.addToHistory.of(false)],
      });
    } else if (prevPath.current !== notePath) {
      view.dispatch({ effects: refresh.of(null) });
    }
    prevPath.current = notePath;
  }, [value, notePath]);

  // Vault images were (re)indexed: re-resolve any `![[name.png]]` embeds.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refresh.of(null) });
  }, [embeds]);

  return <div className="live-editor" ref={host} />;
}

// The EditorView is built once per mount, so a hot-swapped module would leave the old
// extensions running (stale decorations, stale drop handling). Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
