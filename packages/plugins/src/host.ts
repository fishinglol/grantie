import { BLOCK_CARET_SCRIPT } from "./blockCaret.ts";
import { OVERLAY_WHEEL_SCRIPT, SCROLL_CHAIN_SCRIPT } from "./scrollChain.ts";
import { SLASH_SCRIPT } from "./slash.ts";
import { METHOD_PERMISSION, checkPluginCss, safeNotePath, type CaretEvent, type CommandInfo, type HeaderButton, type SyncCursor, type SyncEvent } from "./api.ts";
import { checkLinkProvider, checkSvgIcon, findLinkProvider, svgDataUri, type LinkChip, type LinkProvider } from "./links.ts";
import { mergeIconConfigs, parseIconConfig, type IconConfig } from "./icons.ts";
import type { PluginManifest } from "./manifest.ts";

/**
 * The open note's side of a live session (plugin API 6). Each app forwards it to the editor (`LiveEditorHandle.sync`), whose
 * `SyncPort` has the same shape; the host only carries the messages and checks them.
 */
export interface SyncPort {
  start(listener: (event: SyncEvent) => void): string;
  stop(): void;
  remote(changes: unknown): void;
  ack(): void;
  setCursors(cursors: SyncCursor[]): void;
}

const MAX_CURSORS = 50;
const MAX_SYNC_JSON = 2_000_000;

/** Carets from a plugin end up in the editor's CSS and DOM, so each field is checked. Throws with a readable message. */
export function checkCursors(value: unknown): SyncCursor[] {
  if (!Array.isArray(value) || value.length > MAX_CURSORS) throw new Error(`setCursors takes a list of up to ${MAX_CURSORS} carets`);
  return value.map((c: unknown) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const pos = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 31;
    if (typeof o.id !== "string" || o.id === "" || o.id.length > 64) throw new Error("a caret needs an id (up to 64 characters)");
    if (typeof o.name !== "string" || o.name.length > 40) throw new Error("a caret's name must be text of up to 40 characters");
    if (typeof o.color !== "string" || !/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error("a caret's color must look like #rrggbb");
    if (!pos(o.anchor) || !pos(o.head)) throw new Error("a caret's anchor and head must be whole numbers, 0 or more");
    return { id: o.id, name: o.name, color: o.color, anchor: o.anchor as number, head: o.head as number };
  });
}

/**
 * What the app lends to plugins. Each app (desktop, phone) implements this once; the host below is
 * identical on both. Only what a plugin's manifest permits is ever called.
 */
export interface HostAdapter {
  getText(): string;
  getSelection(): string;
  replaceSelection(text: string): void;
  setText(text: string): void;
  listNotes(): Promise<string[]>;
  readNote(path: string): Promise<string>;
  writeNote(path: string, text: string): Promise<void>;
  /**
   * Show this note in the editor (vault-relative path). `beside`: keep what is showing and open it next to it (desktop split view;
   * the phone shows it full screen with a way back). `origin` is the plugin block the call came from, when it came from one.
   */
  openNote(path: string, options?: { beside?: boolean; origin?: HTMLElement | null }): Promise<void>;
  notice(message: string): void;
  /** Open a web address (http / https) in the system browser. */
  openUrl?(url: string): void;
  /** The open note's live-session port; absent where the app can't do it. */
  sync?: SyncPort;
  /** Put text on the clipboard. Absent: the host tries the web view's own clipboard. */
  copyText?(text: string): Promise<void>;
}

const OPTIONS_KEY = "granite-plugin-options:";
const MAX_OPTIONS = 20_000;

/** A command that hasn't finished after this long is assumed stuck; its plugin is shut down. */
const COMMAND_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 5_000;
const INPUT_TIMEOUT_MS = 5_000;

/**
 * The page a plugin runs in. It gets an opaque origin (`sandbox` without `allow-same-origin`), so it
 * cannot touch the app's DOM, storage or native bridge, and a CSP that blocks every network request
 * unless the manifest asked for `network`. Its only way out is `postMessage` to the host.
 */
function bootstrapHtml(network: boolean, block: boolean, connect: string[] = [], ui = false, overlay = false): string {
  // A block frame is visible (it is drawn inside the note), so it may style itself and show inline images. So may a plugin's window (`ui.panel`).
  const styled = block || ui || overlay;
  // The overlay is told what the user types, so it never gets the network, whatever the manifest says.
  if (overlay) [network, connect] = [false, []];
  const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'${styled ? "; style-src 'unsafe-inline'; img-src data:" : ""}${network || connect.length > 0 ? `; connect-src ${[...(network ? ["https:", "wss:"] : []), ...connect].join(" ")}` : ""}`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">${block ? "<style>html,body{margin:0;background:transparent}</style>" : overlay ? "<style>html,body{margin:0;background:transparent;overflow:hidden}</style>" : ui ? "<style>html,body{margin:0;background:var(--panel);color:var(--text);font:14px system-ui,sans-serif}</style>" : ""}<script>
(function () {
  var host = window.parent, pending = {}, seq = 0, commands = {}, isBlock = false, blockFns = {}, blockHandle = null, triggers = {}, pasteFn = null, items = {}, linkTitles = {}, syncHandler = null, panelFn = null, panelHandle = null, isOverlay = false, overlayFn = null, caretFn = null, optionsFn = null, vaultFns = [];
  function applyVars(vars) { for (var k in vars) document.documentElement.style.setProperty(k, vars[k]); }
  function send(m) { host.postMessage(m, "*"); }
  function call(method, args) {
    if (isOverlay) return Promise.reject(new Error("the overlay can only draw; do this in the plugin's other frame"));
    return new Promise(function (resolve, reject) {
      var n = ++seq;
      pending[n] = { resolve: resolve, reject: reject };
      send({ k: "call", n: n, method: method, args: args });
    });
  }
  window.granite = Object.freeze({
    commands: Object.freeze({ add: function (c) {
      if (!c || typeof c.id !== "string" || typeof c.run !== "function") throw new Error("commands.add needs { id, name, run }");
      commands[c.id] = c.run;
      send({ k: "cmd", id: c.id, name: String(c.name || c.id), page: c.page === true });
    } }),
    editor: Object.freeze({
      getText: function () { return call("editor.getText", []); },
      getSelection: function () { return call("editor.getSelection", []); },
      replaceSelection: function (t) { return call("editor.replaceSelection", [t]); },
      setText: function (t) { return call("editor.setText", [t]); },
      setStyle: function (css) { return call("editor.setStyle", [css]); },
      sync: Object.freeze({
        start: function (onEvent) {
          if (typeof onEvent !== "function") throw new Error("sync.start needs a handler");
          syncHandler = onEvent;
          return call("sync.start", []);
        },
        stop: function () { syncHandler = null; return call("sync.stop", []); },
        remote: function (changes) { return call("sync.remote", [changes]); },
        ack: function () { return call("sync.ack", []); },
        setCursors: function (list) { return call("sync.setCursors", [list]); }
      })
    }),
    caret: Object.freeze({
      overlay: function (fn) {
        if (typeof fn !== "function") throw new Error("caret.overlay needs a render function");
        overlayFn = fn;
        if (!isBlock) return call("caret.overlay", []);
      },
      get inOverlay() { return isOverlay; },
      setOptions: function (o) { return call("caret.setOptions", [o === undefined ? null : o]); },
      getOptions: function () { return call("caret.getOptions", []); }
    }),
    ui: Object.freeze({
      headerButton: function (d) {
        if (!d || typeof d.title !== "string" || typeof d.icon !== "string" || typeof d.open !== "function") throw new Error("ui.headerButton needs { title, icon, open }");
        panelFn = d.open;
        if (!isBlock) return call("ui.button", [d.title, d.icon]);
      },
      setBadge: function (color) { if (!isBlock) return call("ui.badge", [color == null ? null : String(color)]); },
      setIcons: function (icons) { if (!isBlock) return call("ui.icons", [icons == null ? null : icons]); },
      copy: function (t) { return call("ui.copy", [String(t)]); }
    }),
    blocks: Object.freeze({ register: function (lang, fn) {
      if (typeof lang !== "string" || typeof fn !== "function") throw new Error("blocks.register needs (lang, render)");
      blockFns[lang] = fn;
      if (!isBlock) return call("blocks.register", [lang]);
    } }),
    input: Object.freeze({
      trigger: function (text, fn) {
        if (typeof text !== "string" || typeof fn !== "function") throw new Error("input.trigger needs (text, handler)");
        triggers[text] = fn;
        if (!isBlock) return call("input.register", ["trigger", text]);
      },
      onPaste: function (fn) {
        if (typeof fn !== "function") throw new Error("input.onPaste needs a handler");
        pasteFn = fn;
        if (!isBlock) return call("input.register", ["paste", ""]);
      },
      addItem: function (d) {
        if (!d || typeof d.id !== "string" || typeof d.name !== "string" || typeof d.insert !== "function") throw new Error("input.addItem needs { id, name, insert }");
        items[d.id] = d.insert;
        if (!isBlock) return call("input.register", ["item", d.id, d.name, String(d.description || "")]);
      }
    }),
    links: Object.freeze({
      register: function (list) {
        var metas = [];
        (Array.isArray(list) ? list : [list]).forEach(function (p) {
          if (!p || typeof p.id !== "string") throw new Error("links.register needs { id, name, hosts, color, icon }");
          if (typeof p.title === "function") linkTitles[p.id] = p.title;
          metas.push({ id: p.id, name: p.name, label: p.label, hosts: p.hosts, color: p.color, icon: p.icon });
        });
        if (!isBlock) return call("links.register", [metas]);
      },
      chip: function (url) { return call("links.chip", [url]); },
      title: function (url) { return call("links.title", [url]); },
      open: function (url) { return call("links.open", [url]); }
    }),
    vault: Object.freeze({
      list: function () { return call("vault.list", []); },
      read: function (p) { return call("vault.read", [p]); },
      write: function (p, t) { return call("vault.write", [p, t]); },
      open: function (p, o) { return call("vault.open", [p, !!(o && o.beside)]); },
      onChange: function (f) { if (typeof f === "function") vaultFns.push(f); }
    }),
    notice: function (m) { send({ k: "call", n: 0, method: "notice", args: [String(m)] }); }
  });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") send({ k: "panel-close" }); });
  window.addEventListener("error", function (e) { send({ k: "error", message: String(e.message) }); });
  window.addEventListener("unhandledrejection", function (e) { send({ k: "error", message: String(e.reason && e.reason.message || e.reason) }); });
  window.addEventListener("message", function (e) {
    if (e.source !== host) return;
    var m = e.data;
    if (m.k === "init") {
      try {
        if (m.block) { isBlock = true; applyVars(m.block.vars); }
        if (m.overlay) { isBlock = isOverlay = true; applyVars(m.overlay.vars); }
        (0, eval)(m.code);
        if (m.overlay) {
          if (!overlayFn) throw new Error("this plugin does not draw an overlay");
          overlayFn(document.body, Object.freeze({
            onCaret: function (f) { if (typeof f === "function") caretFn = f; },
            onOptions: function (f) { if (typeof f === "function") optionsFn = f; }
          }));
          if (m.overlay.options !== null && optionsFn) optionsFn(m.overlay.options);
          if (m.overlay.caret && caretFn) caretFn(m.overlay.caret);
        }
        if (m.block) {
          var render = blockFns[m.block.lang];
          if (!render) throw new Error("this plugin does not draw " + m.block.lang + " blocks");
          blockHandle = render(document.body, m.block.source, Object.freeze({
            save: function (s) { send({ k: "block-save", source: String(s) }); },
            resize: function (h) { send({ k: "block-resize", height: h === "fill" ? "fill" : Number(h) }); },
            remove: function () { send({ k: "block-remove" }); },
            edit: function () { send({ k: "block-edit" }); }
          })) || null;
        }
        send({ k: "ready" });
      }
      catch (err) { send({ k: "error", message: String(err && err.message || err), fatal: true }); }
    } else if (m.k === "panel-open") {
      applyVars(m.vars);
      try {
        if (!panelFn) throw new Error("this plugin has no window");
        panelHandle = panelFn(document.body, Object.freeze({
          close: function () { send({ k: "panel-close" }); },
          resize: function (h) { send({ k: "panel-resize", height: Number(h) }); }
        })) || null;
      }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); send({ k: "panel-close" }); }
    } else if (m.k === "panel-close") {
      try { if (panelHandle && panelHandle.close) panelHandle.close(); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
      panelHandle = null;
    } else if (m.k === "block-update") {
      applyVars(m.vars);
      try { if (blockHandle && blockHandle.update) blockHandle.update(m.source); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
    } else if (m.k === "caret") {
      try { if (caretFn) caretFn(m.event); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
    } else if (m.k === "caret-options") {
      try { if (optionsFn) optionsFn(m.options); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
    } else if (m.k === "vault-changed") {
      vaultFns.forEach(function (f) {
        try { f(); } catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
      });
    } else if (m.k === "sync") {
      try { if (syncHandler) syncHandler(m.event); }
      catch (err) { send({ k: "error", message: String(err && err.message || err) }); }
    } else if (m.k === "result") {
      var p = pending[m.n]; delete pending[m.n];
      if (p) { if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error)); }
    } else if (m.k === "input-run") {
      Promise.resolve().then(function () {
        var fn = m.kind === "paste" ? pasteFn : m.kind === "item" ? items[m.text] : m.kind === "link" ? linkTitles[m.text] : triggers[m.text];
        return fn ? (m.kind === "paste" ? fn({ text: String(m.text), html: String(m.html) }) : m.kind === "link" ? fn(String(m.url)) : fn()) : null;
      }).then(
        function (v) { send({ k: "input-done", n: m.n, value: typeof v === "string" ? v : null }); },
        function (err) { send({ k: "input-done", n: m.n, value: null, error: String(err && err.message || err) }); }
      );
    } else if (m.k === "run") {
      Promise.resolve().then(function () { return commands[m.id] && commands[m.id](); }).then(
        function () { send({ k: "done", n: m.n }); },
        function (err) { send({ k: "done", n: m.n, error: String(err && err.message || err) }); }
      );
    }
  });
  send({ k: "boot" });
})();
</script>${block ? "<script>" + SLASH_SCRIPT + "</script><script>" + SCROLL_CHAIN_SCRIPT + "</script><script>" + BLOCK_CARET_SCRIPT + "</script>" : ""}${overlay ? "<script>" + OVERLAY_WHEEL_SCRIPT + "</script>" : ""}`;
}

/** Scrolls the nearest scrollable ancestor of a block's container (outside the iframe, in the note's own DOM) by `dy`. */
/** Scroll the nearest element from `el` up that can still move that way (the page itself when none can). */
function scrollFrom(el: Element, dx: number, dy: number): void {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const y = dy !== 0 && /(auto|scroll)/.test(cs.overflowY) && (dy < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    const x = dx !== 0 && /(auto|scroll)/.test(cs.overflowX) && (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    if (x || y) {
      node.scrollBy(x ? dx : 0, y ? dy : 0);
      return;
    }
  }
  document.scrollingElement?.scrollBy(dx, dy);
}

function scrollNoteBy(el: HTMLElement, dy: number): void {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      node.scrollTop += dy;
      return;
    }
  }
  document.scrollingElement?.scrollBy(0, dy);
}

/** A caret event from a block frame (`blockCaret.ts`), checked, or null. Positions are the frame's own pixels. */
function checkCaretEvent(raw: unknown): CaretEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  let caret: CaretEvent["caret"] = null;
  if (e.caret !== null) {
    const c = e.caret as Record<string, unknown> | undefined;
    const n = [c?.x, c?.y, c?.width, c?.height];
    if (!n.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100_000)) return null;
    caret = { x: c!.x as number, y: c!.y as number, width: Math.max(0, c!.width as number), height: Math.max(0, c!.height as number) };
  }
  if (e.type === "move") return { type: "move", caret, selecting: e.selecting === true, scroll: e.scroll === true };
  if (e.type === "enter") return { type: "enter", caret };
  if ((e.type === "type" || e.type === "delete") && typeof e.text === "string") return { type: e.type, text: e.text.slice(0, 32), caret };
  return null;
}

/** One drawn block: a visible frame inside the note, running the same plugin code in "block" mode. */
interface BlockFrame {
  plugin: Loaded;
  frame: HTMLIFrameElement;
  container: HTMLElement;
  lang: string;
  source: string;
  actions: BlockActions;
}

function blockFrame(manifest: PluginManifest, container: HTMLElement): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.title = manifest.name;
  frame.style.cssText = "display:block;width:100%;height:160px;border:0;background:transparent";
  frame.srcdoc = bootstrapHtml(manifest.permissions.includes("network"), true, manifest.connect);
  container.append(frame);
  return frame;
}

/** What a block frame may ask of the note; the editor implements these for the block it drew. */
export interface BlockActions {
  save(source: string): void;
  remove(): void;
  edit(): void;
}

const MAX_COPY = 10_000;
/** The plugin's window: a centred card on a wide screen, a sheet from the bottom on a narrow one. */
const PANEL_CSS =
  ".granite-panel-backdrop{position:fixed;inset:0;z-index:2147482999;background:rgba(0,0,0,.45)}" +
  ".granite-panel-frame{position:fixed;z-index:2147483000;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,calc(100vw - 24px));max-height:calc(100vh - 24px);border:0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);background:transparent}" +
  "@media (max-width:600px){.granite-panel-frame{left:0;right:0;top:auto;bottom:0;transform:none;width:100%;max-height:90vh;border-radius:16px 16px 0 0}}";

/** Blocks may not grow taller than this (px); the block scrolls inside itself past it. */
const MAX_BLOCK_HEIGHT = 1200;
const MAX_BLOCK_SOURCE = 2_000_000;
/** The editor's theme variables, handed to block frames (their opaque origin can't read the app's CSS). */
const THEME_VARS = ["--text", "--h", "--text-dim", "--text-faint", "--accent", "--bg", "--panel", "--panel-hover", "--border"];

function themeVars(el: HTMLElement): Record<string, string> {
  const cs = getComputedStyle(el);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = cs.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  // A frame whose colour scheme differs from the page around it gets an opaque backdrop; matching it keeps it see-through.
  if (cs.colorScheme && cs.colorScheme !== "normal") vars["color-scheme"] = cs.colorScheme;
  return vars;
}

/** One entry of the `//` list. `key` is what `runInput("item", { text: key })` takes. */
export interface MenuItem {
  key: string;
  name: string;
  description: string;
  /** Name of the plugin that offers it. */
  plugin: string;
}

/** What the editor needs to draw plugin blocks; `BlockBridge` below is the stable object an app hands it. */
export interface BlockMount {
  update(source: string): void;
  destroy(): void;
}

interface Loaded {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  /** Languages this plugin draws (```lang fences). */
  blockLangs: Set<string>;
  commands: Map<string, { name: string; page: boolean }>;
  /** Its button at the top of the note (`ui.headerButton`) and the dot on it. */
  button?: { title: string; icon: string };
  badge: string | null;
  /** The icons it gave notes and folders in the sidebar (`ui.setIcons`). */
  icons?: IconConfig;
  /** Texts the user may type alone on a line to trigger it, and whether it takes over pasted spreadsheet text. */
  triggers: Set<string>;
  paste: boolean;
  /** Entries this plugin put in the `//` list. */
  items: Map<string, { name: string; description: string }>;
  /** Sites this plugin draws as chips. */
  links: Map<string, LinkProvider>;
  inputs: Map<number, { resolve: (value: string | null) => void; timer: ReturnType<typeof setTimeout> }>;
  runs: Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  /** Its layer over the editor (`caret.overlay`) and the last caret it was told about (what a restarted overlay starts from). */
  overlay?: { frame: HTMLIFrameElement; caret: CaretEvent | null };
  /** What `caret.setOptions` last saved (`undefined`: not read from the device yet). */
  options?: unknown;
  code: string;
  started?: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
}

/** Runs enabled plugins, each in its own sandboxed frame, and answers their calls. Needs a DOM. */
export class PluginHost {
  readonly #adapter: HostAdapter;
  readonly #onCommands: () => void;
  readonly #onBlocks: () => void;
  readonly #onButtons: () => void;
  readonly #onIcons: () => void;
  readonly #plugins = new Map<string, Loaded>();
  readonly #blocks = new Set<BlockFrame>();
  #runSeq = 0;
  /** The plugin whose live session the open note is in (one at a time). */
  #syncOwner: string | null = null;
  /** Identifies that session, so a late "ended" from an earlier one (the plugin restarting its own) can't end this one. */
  #syncToken: object | null = null;
  /** The plugin window that is open, and the dimmed layer behind it. */
  #panel: { plugin: Loaded; backdrop: HTMLElement } | null = null;
  /** Plugin styles are switched off (`pauseStyles`). */
  #stylesPaused = false;
  /** The block whose text field has the caret (it reports it itself), or null when the note's editor has it. */
  #caretBlock: { block: BlockFrame; caret: CaretEvent["caret"]; selecting: boolean } | null = null;

  constructor(adapter: HostAdapter, onCommandsChanged: () => void = () => {}, onBlocksChanged: () => void = () => {}, onButtonsChanged: () => void = () => {}, onIconsChanged: () => void = () => {}) {
    this.#adapter = adapter;
    this.#onCommands = onCommandsChanged;
    this.#onBlocks = onBlocksChanged;
    this.#onButtons = onButtonsChanged;
    this.#onIcons = onIconsChanged;
    window.addEventListener("message", this.#onMessage);
    window.addEventListener("scroll", this.#onScroll, true);
  }

  /** Start a plugin. Resolves once its code has run; rejects with the plugin's own error. */
  load(manifest: PluginManifest, code: string): Promise<void> {
    this.unload(manifest.id);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "display:none;width:0;height:0;border:0";
    frame.srcdoc = bootstrapHtml(manifest.permissions.includes("network"), false, manifest.connect, manifest.permissions.includes("ui.panel"));
    const entry: Loaded = { manifest, frame, blockLangs: new Set(), commands: new Map(), badge: null, triggers: new Set(), paste: false, items: new Map(), links: new Map(), inputs: new Map(), runs: new Map(), code };
    this.#plugins.set(manifest.id, entry);
    const started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unload(manifest.id);
        reject(new Error("the plugin did not start"));
      }, START_TIMEOUT_MS);
      entry.started = { resolve, reject, timer };
    });
    document.body.append(frame);
    return started;
  }

  unload(id: string): void {
    const entry = this.#plugins.get(id);
    if (!entry) return;
    this.#plugins.delete(id);
    if (this.#syncOwner === id) this.#endSync();
    if (this.#panel?.plugin === entry) this.closePanel();
    if (entry.button) this.#onButtons();
    if (entry.icons) this.#onIcons();
    entry.frame.remove();
    entry.overlay?.frame.remove();
    this.#setStyle(id, ""); // a plugin's look goes away with it
    for (const lang of entry.blockLangs) this.#handOver(lang);
    if (entry.blockLangs.size > 0 || entry.links.size > 0) this.#onBlocks(); // its blocks and chips turn back into plain text
    for (const run of entry.runs.values()) {
      clearTimeout(run.timer);
      run.reject(new Error("plugin was stopped"));
    }
    for (const input of entry.inputs.values()) {
      clearTimeout(input.timer);
      input.resolve(null);
    }
    if (entry.started) {
      clearTimeout(entry.started.timer);
      entry.started.reject(new Error("plugin was stopped"));
    }
    this.#onCommands();
  }

  #endSync(): void {
    this.#syncOwner = null;
    this.#syncToken = null;
    try {
      this.#adapter.sync?.stop();
    } catch {
      // the editor is gone already
    }
  }

  isLoaded(id: string): boolean {
    return this.#plugins.has(id);
  }

  /**
   * Running plugins that asked for something, id order. When several ask for the same thing (a block language, a trigger) the first
   * gets it: plugins start in parallel, so "whoever registered first" would differ between launches and between desktop and phone.
   */
  #claimants(has: (p: Loaded) => boolean): Loaded[] {
    return [...this.#plugins.values()].filter(has).sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  }

  #blockOwner(lang: string): Loaded | undefined {
    return this.#claimants((p) => p.blockLangs.has(lang))[0];
  }

  /** Languages of the fenced blocks running plugins draw. */
  blockLangs(): string[] {
    return [...new Set([...this.#plugins.values()].flatMap((p) => [...p.blockLangs]))].sort();
  }

  /** Name of the running plugin that draws ```lang blocks. */
  blockLabel(lang: string): string {
    return this.#blockOwner(lang)?.manifest.name ?? lang;
  }

  /**
   * Draw a ```lang block: puts a frame running the plugin into `container`. `actions` write the block's new text back
   * to the note, delete it, or open it as text. The frame is removed by `destroy()`.
   */
  mountBlock(lang: string, container: HTMLElement, source: string, actions: BlockActions): BlockMount {
    const plugin = this.#blockOwner(lang);
    if (!plugin) throw new Error(`no running plugin draws "${lang}" blocks`);
    const block: BlockFrame = { plugin, frame: blockFrame(plugin.manifest, container), container, lang, source, actions };
    this.#blocks.add(block);
    return {
      update: (next) => {
        if (next === block.source) return; // the frame's own save coming back around
        block.source = next;
        block.frame.contentWindow?.postMessage({ k: "block-update", source: next, vars: themeVars(container) }, "*");
      },
      destroy: () => {
        this.#blocks.delete(block);
        this.#dropCaretBlock(block);
        block.frame.remove();
      },
    };
  }

  /**
   * Blocks of `lang` drawn by a plugin that no longer owns it get a new frame running the owner, in place (the editor keeps its
   * widget, since the text did not change); with no owner left the frame goes and the note shows the text.
   */
  #handOver(lang: string): void {
    const owner = this.#blockOwner(lang);
    for (const b of [...this.#blocks]) {
      if (b.lang !== lang || b.plugin === owner) continue;
      this.#dropCaretBlock(b);
      b.frame.remove();
      b.container.classList.remove("cm-plugin-block-page");
      if (!owner) {
        this.#blocks.delete(b);
        continue;
      }
      b.plugin = owner;
      b.frame = blockFrame(owner.manifest, b.container);
    }
  }

  /** True while a running plugin draws over the editor (`caret.overlay`); the editor measures the caret only then. */
  wantsCaret(): boolean {
    return [...this.#plugins.values()].some((p) => p.overlay);
  }

  /**
   * The note's editor reporting its caret. While a block's text field has the caret, the editor has nothing to add (it lost focus to
   * that block; its "no caret" may even arrive after the block's "here"), until the editor has the caret again.
   */
  caretEvent(event: CaretEvent): void {
    if (event.type === "move" && event.caret) this.#caretBlock = null;
    else if (this.#caretBlock) return;
    this.#sendCaret(event);
  }

  /** A block frame reporting the caret of one of its text fields, moved from the frame's pixels into the window's. */
  #onBlockCaret(block: BlockFrame, raw: unknown): void {
    const event = checkCaretEvent(raw);
    if (!event || !this.wantsCaret()) return;
    // A block kept alive hidden behind another pane/sheet (`display:none`) can still hold a stale `activeElement` and
    // report a caret nobody sees; it must never claim or drop `#caretBlock`, or the overlay jumps to its position.
    if (block.container.getClientRects?.().length === 0) return;
    if (event.type === "move" && event.caret) this.#caretBlock = { block, caret: event.caret, selecting: event.selecting };
    else if (this.#caretBlock?.block !== block) return; // old news from a block the caret already left
    else if (event.type === "move") this.#caretBlock = null;
    this.#sendCaret(this.#inWindow(block, event));
  }

  #inWindow<E extends CaretEvent>(block: BlockFrame, event: E): E {
    if (!event.caret) return event;
    const r = block.frame.getBoundingClientRect();
    return { ...event, caret: { ...event.caret, x: event.caret.x + r.left, y: event.caret.y + r.top } };
  }

  /** The note (or anything else) scrolled: a block's caret moved on screen with its frame. */
  #onScroll = (e: Event): void => {
    const at = this.#caretBlock;
    if (e.type !== "scroll" || !at || !at.caret) return;
    this.#sendCaret(this.#inWindow(at.block, { type: "move", caret: at.caret, selecting: at.selecting, scroll: true }));
  };

  /** The vault's list of notes changed (created, renamed, deleted, synced in): tell block frames that listen with `vault.onChange`. */
  notesChanged(): void {
    for (const b of this.#blocks) b.frame.contentWindow?.postMessage({ k: "vault-changed" }, "*");
  }

  /** Whether block frames should report their caret, and hide their own (as the plugin hid the note's, with `editor.setStyle`). */
  #tellBlocksCaret(): void {
    const on = this.wantsCaret() && !this.#stylesPaused;
    const content = on ? document.querySelector(".live-editor .cm-content") : null;
    const hide = content !== null && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(getComputedStyle(content).caretColor);
    for (const b of this.#blocks) b.frame.contentWindow?.postMessage({ k: "caret-want", on, hide }, "*");
    if (!on && this.#caretBlock) this.#caretBlock = null;
  }

  /** A block that had the caret is gone (or now runs another plugin's frame): the caret went with it. */
  #dropCaretBlock(block: BlockFrame): void {
    if (this.#caretBlock?.block !== block) return;
    this.#caretBlock = null;
    this.#sendCaret({ type: "move", caret: null, selecting: false, scroll: false });
  }

  /** Tell every overlay where the caret is and what was typed. */
  #sendCaret(event: CaretEvent): void {
    for (const p of this.#plugins.values()) {
      if (!p.overlay) continue;
      if (event.type === "move") p.overlay.caret = event;
      p.overlay.frame.contentWindow?.postMessage({ k: "caret", event }, "*");
    }
  }

  /** What `caret.setOptions` saved for a plugin (kept on this device, in the app's own storage; not in the vault). */
  #options(entry: Loaded): unknown {
    if (entry.options === undefined) {
      try {
        const saved = localStorage.getItem(OPTIONS_KEY + entry.manifest.id);
        entry.options = saved === null ? null : (JSON.parse(saved) as unknown);
      } catch {
        entry.options = null; // no storage here, or something unreadable in it
      }
    }
    return entry.options;
  }

  /** Texts running plugins want to see typed alone on a line. */
  inputTriggers(): string[] {
    return [...new Set([...this.#plugins.values()].flatMap((p) => [...p.triggers]))];
  }

  /** True when a running plugin wants to see pasted spreadsheet text. */
  hasPasteHook(): boolean {
    return [...this.#plugins.values()].some((p) => p.paste);
  }

  /**
   * The entries of the `//` list. A plugin from before API 4 that answers `//` gets one entry (its own name), so it is not lost
   * when the list takes over that text.
   */
  menuItems(): MenuItem[] {
    return [...this.#plugins.values()]
      .flatMap((p) => {
        const items: MenuItem[] = [...p.items].map(([id, i]) => ({ key: `${p.manifest.id}:item:${id}`, name: i.name, description: i.description, plugin: p.manifest.name }));
        if (p.items.size === 0 && p.triggers.has("//")) items.push({ key: `${p.manifest.id}:trigger`, name: p.manifest.name, description: p.manifest.tagline ?? "", plugin: p.manifest.name });
        return items;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The chip a link to `url` is drawn as, or null when no running plugin knows that site. */
  linkChip(url: string): LinkChip | null {
    // Id order, so of two plugins naming the same site the same one wins on every launch (`findLinkProvider` keeps the first of a tie).
    const all = this.#claimants((p) => p.links.size > 0).flatMap((p) => [...p.links.values()].map((l) => ({ ...l, plugin: p.manifest.id })));
    const found = findLinkProvider(all, url);
    return found && { key: `${found.plugin}:${found.id}`, name: found.name, label: found.label, color: found.color, icon: svgDataUri(found.icon) };
  }

  /**
   * Ask the plugin that registered `trigger` (or the paste hook, or the `item` with this `MenuItem.key`) what to insert. With `"link"`
   * (`payload.text` is a `LinkChip.key`, `payload.url` the address) it asks for the page's title. Resolves null when the plugin declines,
   * fails or takes longer than 5 seconds (the editor then leaves the typed or pasted text alone).
   */
  runInput(kind: "trigger" | "paste" | "item" | "link", payload: { text: string; html?: string; url?: string }): Promise<string | null> {
    let sent: "trigger" | "paste" | "item" | "link" = kind;
    let text = payload.text;
    let entry: Loaded | undefined;
    if (kind === "item" || kind === "link") {
      const [pluginId, type, id] = text.split(":");
      entry = this.#plugins.get(pluginId ?? "");
      if (kind === "link") text = type ?? "";
      else if (type === "trigger") [sent, text] = ["trigger", "//"];
      else text = id ?? "";
    } else if (kind === "paste") {
      return this.#paste(payload);
    } else {
      entry = this.#claimants((p) => p.triggers.has(text))[0];
    }
    if (!entry) return Promise.resolve(null);
    return this.#ask(entry, sent, text, payload, INPUT_TIMEOUT_MS);
  }

  /** Every plugin with a paste hook is asked in id order until one takes the paste; together they have `INPUT_TIMEOUT_MS`. */
  async #paste(payload: { text: string; html?: string }): Promise<string | null> {
    const end = Date.now() + INPUT_TIMEOUT_MS;
    for (const entry of this.#claimants((p) => p.paste)) {
      const left = end - Date.now();
      if (left <= 0) break;
      const out = await this.#ask(entry, "paste", payload.text, payload, left);
      if (out !== null) return out;
    }
    return null;
  }

  #ask(entry: Loaded, kind: "trigger" | "paste" | "item" | "link", text: string, payload: { html?: string; url?: string }, ms: number): Promise<string | null> {
    const n = ++this.#runSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        entry.inputs.delete(n);
        resolve(null);
      }, ms);
      entry.inputs.set(n, { resolve, timer });
      entry.frame.contentWindow?.postMessage({ k: "input-run", n, kind, text, html: payload.html ?? "", url: payload.url ?? "" }, "*");
    });
  }

  /** The icons running plugins gave notes and folders, as one table (by plugin id, so the same plugin wins on every launch). */
  iconConfig(): IconConfig {
    return mergeIconConfigs([...this.#plugins.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).flatMap((p) => (p.icons ? [p.icons] : [])));
  }

  /** The buttons running plugins put at the top of a note (`ui.headerButton`). */
  headerButtons(): HeaderButton[] {
    return [...this.#plugins.values()]
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)) // not start order, which differs between launches
      .flatMap((p) => (p.button ? [{ pluginId: p.manifest.id, title: p.button.title, icon: svgDataUri(p.button.icon), badge: p.badge }] : []));
  }

  /** Show the window of the plugin whose button was pressed (closing any other). No-op when it has none. */
  openPanel(pluginId: string): void {
    const entry = this.#plugins.get(pluginId);
    if (!entry?.button) return;
    this.closePanel();
    if (!document.head.querySelector("style[data-granite-panel]")) {
      const style = document.createElement("style");
      style.setAttribute("data-granite-panel", "");
      style.textContent = PANEL_CSS;
      document.head.append(style);
    }
    const backdrop = document.createElement("div");
    backdrop.className = "granite-panel-backdrop";
    backdrop.addEventListener("pointerdown", () => this.closePanel());
    document.body.append(backdrop);
    entry.frame.className = "granite-panel-frame";
    entry.frame.style.cssText = "height:420px";
    entry.frame.setAttribute("aria-hidden", "false");
    entry.frame.title = entry.button.title;
    this.#panel = { plugin: entry, backdrop };
    // Vars come from the editor (that is where the theme is defined), as they do for a block.
    entry.frame.contentWindow?.postMessage({ k: "panel-open", vars: themeVars((document.querySelector(".live-editor") as HTMLElement | null) ?? document.documentElement) }, "*");
  }

  closePanel(): void {
    const panel = this.#panel;
    if (!panel) return;
    this.#panel = null;
    panel.backdrop.remove();
    panel.plugin.frame.className = "";
    panel.plugin.frame.style.cssText = "display:none;width:0;height:0;border:0";
    panel.plugin.frame.setAttribute("aria-hidden", "true");
    panel.plugin.frame.contentWindow?.postMessage({ k: "panel-close" }, "*");
  }

  async #copy(text: string): Promise<void> {
    if (text.length > MAX_COPY) throw new Error(`copy takes at most ${MAX_COPY} characters`);
    if (this.#adapter.copyText) return this.#adapter.copyText(text);
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // not allowed from here; try the older way below
    }
    const box = document.createElement("textarea");
    box.value = text;
    box.style.cssText = "position:fixed;opacity:0";
    document.body.append(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    if (!ok) throw new Error("could not copy; select the text and copy it yourself");
  }

  commands(): CommandInfo[] {
    return [...this.#plugins.values()].flatMap((p) =>
      [...p.commands].map(([id, c]) => ({ pluginId: p.manifest.id, id, name: c.name, page: c.page })),
    );
  }

  runCommand(pluginId: string, commandId: string): Promise<void> {
    const entry = this.#plugins.get(pluginId);
    if (!entry) return Promise.reject(new Error("plugin is not running"));
    const n = ++this.#runSeq;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.unload(pluginId);
        reject(new Error(`"${entry.manifest.name}" did not finish and was stopped`));
      }, COMMAND_TIMEOUT_MS);
      entry.runs.set(n, { resolve, reject, timer });
      entry.frame.contentWindow?.postMessage({ k: "run", n, id: commandId }, "*");
    });
  }

  dispose(): void {
    window.removeEventListener("message", this.#onMessage);
    window.removeEventListener("scroll", this.#onScroll, true);
    for (const id of [...this.#plugins.keys()]) this.unload(id);
  }

  #onBlockMessage(block: BlockFrame, d: { k?: string; [key: string]: unknown }): void {
    const { manifest } = block.plugin;
    const post = (message: unknown) => block.frame.contentWindow?.postMessage(message, "*");
    switch (d.k) {
      case "boot":
        post({ k: "init", code: block.plugin.code, block: { lang: block.lang, source: block.source, vars: themeVars(block.container) } });
        this.#tellBlocksCaret();
        break;
      case "block-caret":
        this.#onBlockCaret(block, d.event);
        break;
      case "block-save":
        if (typeof d.source !== "string" || d.source.length > MAX_BLOCK_SOURCE) break;
        block.source = d.source; // already what the frame shows, so `update` ignores the note's echo of it
        block.actions.save(d.source);
        break;
      case "block-remove":
        block.actions.remove();
        break;
      case "block-edit":
        block.actions.edit();
        break;
      case "block-resize": {
        // "fill": the block is the whole page. The editor's CSS then makes it edge to edge and as tall as the editor.
        block.container.classList.toggle("cm-plugin-block-page", d.height === "fill");
        if (d.height === "fill") {
          block.frame.style.height = "100%";
          break;
        }
        const h = Number(d.height);
        if (Number.isFinite(h)) block.frame.style.height = `${Math.round(Math.min(Math.max(h, 40), MAX_BLOCK_HEIGHT))}px`;
        break;
      }
      case "block-scroll": { // the frame's own scrollable content ran out of room in this direction (scrollChain.ts)
        const dy = Number(d.dy);
        if (Number.isFinite(dy)) scrollNoteBy(block.container, dy);
        break;
      }
      case "slash-list": // a text field in the frame wants the plugins' entries for its `//` menu (slash.ts)
        post({ k: "slash-items", items: this.menuItems() });
        break;
      case "slash-run": {
        const n = Number(d.n);
        void this.runInput("item", { text: String(d.key) }).then((text) => post({ k: "slash-text", n, text }));
        break;
      }
      case "error":
        this.#adapter.notice(`${manifest.name}: ${String(d.message)}`);
        break;
      case "call": {
        const n = Number(d.n);
        const reply = (ok: boolean, value?: unknown, error?: string) => post({ k: "result", n, ok, value, error });
        void this.#call(manifest, String(d.method), Array.isArray(d.args) ? d.args : [], block.container).then(
          (value) => n && reply(true, value),
          (e: unknown) => n && reply(false, undefined, e instanceof Error ? e.message : String(e)),
        );
        break;
      }
    }
  }

  /**
   * A wheel the overlay caught (it covers the window, and WebKit gives it the wheel even with `pointer-events: none`). Hand it to what
   * is under the pointer as if the overlay were not there: a block frame scrolls its own content; anything else is offered the event
   * first (the canvas zooms and pans on the wheel, the image viewer zooms) and otherwise scrolls.
   */
  #wheelAt(d: { [key: string]: unknown }): void {
    const [x, y, dx, dy] = [d.x, d.y, d.dx, d.dy].map(Number) as [number, number, number, number];
    if (![x, y, dx, dy].every(Number.isFinite)) return;
    const under = document.elementFromPoint(x, y); // the overlay has `pointer-events: none`, so this is what is below it
    if (!under) return;
    const mods = { ctrl: d.ctrl === true, shift: d.shift === true, meta: d.meta === true };
    const block = [...this.#blocks].find((b) => b.frame === under);
    if (block) {
      const r = under.getBoundingClientRect();
      block.frame.contentWindow?.postMessage({ k: "scroll-at", x: x - r.left, y: y - r.top, dx, dy, ...mods }, "*");
      return;
    }
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy, ctrlKey: mods.ctrl, shiftKey: mods.shift, metaKey: mods.meta });
    if (under.dispatchEvent(wheel)) scrollFrom(under, dx, dy);
  }

  /** The overlay is told what the user types, so it may only start up and report errors (and pass on the wheel): none of its `call`s are answered. */
  #onOverlayMessage(entry: Loaded, d: { k?: string; [key: string]: unknown }): void {
    if (d.k === "boot") {
      const vars = themeVars((document.querySelector(".live-editor") as HTMLElement | null) ?? document.documentElement);
      entry.overlay?.frame.contentWindow?.postMessage({ k: "init", code: entry.code, overlay: { vars, options: this.#options(entry), caret: entry.overlay.caret } }, "*");
    } else if (d.k === "overlay-wheel") {
      this.#wheelAt(d);
    } else if (d.k === "error") {
      this.#adapter.notice(`${entry.manifest.name}: ${String(d.message)}`);
      if (d.fatal) {
        entry.overlay?.frame.remove();
        entry.overlay = undefined;
        this.#tellBlocksCaret();
      }
    }
  }

  #onMessage = (event: MessageEvent): void => {
    const d = event.data as { k?: string; [key: string]: unknown } | null;
    if (!d || typeof d !== "object") return;
    const block = [...this.#blocks].find((b) => b.frame.contentWindow === event.source);
    if (block) return this.#onBlockMessage(block, d);
    const layer = [...this.#plugins.values()].find((p) => p.overlay?.frame.contentWindow === event.source);
    if (layer) return this.#onOverlayMessage(layer, d);
    const entry = [...this.#plugins.values()].find((p) => p.frame.contentWindow === event.source);
    if (!entry) return;
    const reply = (n: number, ok: boolean, value?: unknown, error?: string) =>
      entry.frame.contentWindow?.postMessage({ k: "result", n, ok, value, error }, "*");

    switch (d.k) {
      case "boot":
        entry.frame.contentWindow?.postMessage({ k: "init", code: entry.code }, "*");
        break;
      case "ready":
        if (entry.started) {
          clearTimeout(entry.started.timer);
          entry.started.resolve();
          entry.started = undefined;
        }
        break;
      case "error": {
        const message = String(d.message);
        if (entry.started && d.fatal) {
          clearTimeout(entry.started.timer);
          entry.started.reject(new Error(message));
          entry.started = undefined;
          this.unload(entry.manifest.id);
        } else {
          this.#adapter.notice(`${entry.manifest.name}: ${message}`);
        }
        break;
      }
      case "panel-close":
        if (this.#panel?.plugin === entry) this.closePanel();
        break;
      case "panel-resize": {
        const h = Number(d.height);
        if (this.#panel?.plugin === entry && Number.isFinite(h)) entry.frame.style.height = `${Math.round(Math.min(Math.max(h, 120), window.innerHeight * 0.9 || 800))}px`;
        break;
      }
      case "cmd":
        entry.commands.set(String(d.id), { name: String(d.name), page: d.page === true });
        this.#onCommands();
        break;
      case "input-done": {
        const input = entry.inputs.get(Number(d.n));
        if (!input) break;
        entry.inputs.delete(Number(d.n));
        clearTimeout(input.timer);
        if (d.error) this.#adapter.notice(`${entry.manifest.name}: ${String(d.error)}`);
        input.resolve(typeof d.value === "string" && d.value.length <= MAX_BLOCK_SOURCE ? d.value : null);
        break;
      }
      case "done": {
        const run = entry.runs.get(Number(d.n));
        if (!run) break;
        entry.runs.delete(Number(d.n));
        clearTimeout(run.timer);
        if (d.error) run.reject(new Error(String(d.error)));
        else run.resolve();
        break;
      }
      case "call": {
        const n = Number(d.n);
        void this.#call(entry.manifest, String(d.method), Array.isArray(d.args) ? d.args : []).then(
          (value) => n && reply(n, true, value),
          (e: unknown) => n && reply(n, false, undefined, e instanceof Error ? e.message : String(e)),
        );
        break;
      }
    }
  };

  /**
   * Switch every plugin's styles (and overlays) off (or back on). Plugin CSS applies to the whole window, so the app pauses it while it shows
   * something a stylesheet must not be able to hide or disguise: the permissions a plugin asks for, a delete confirmation.
   */
  pauseStyles(paused: boolean): void {
    this.#stylesPaused = paused;
    document.head.querySelectorAll("style[data-granite-plugin]").forEach((style) => style.setAttribute("media", paused ? "not all" : "all"));
    // A layer over the whole window could just as well cover those screens (and draw a fake one), so overlays are hidden too.
    for (const p of this.#plugins.values()) if (p.overlay) p.overlay.frame.style.display = paused ? "none" : ""; // not `visibility`: a hidden frame can still take the wheel
    this.#tellBlocksCaret();
  }

  /** One `<style>` per plugin in the app's document (which is where the editor lives, on desktop and phone). */
  #setStyle(id: string, css: string): void {
    const existing = document.head.querySelector(`style[data-granite-plugin="${id}"]`);
    if (css === "") {
      existing?.remove();
    } else {
      const style = existing ?? document.createElement("style");
      style.setAttribute("data-granite-plugin", id);
      style.setAttribute("media", this.#stylesPaused ? "not all" : "all");
      style.textContent = css;
      if (!existing) document.head.append(style);
    }
    this.#tellBlocksCaret(); // the style may hide (or show again) the note's caret; blocks follow it
  }

  async #call(manifest: PluginManifest, method: string, args: unknown[], origin: HTMLElement | null = null): Promise<unknown> {
    if (!(method in METHOD_PERMISSION)) throw new Error(`unknown method "${method}"`);
    const needed = METHOD_PERMISSION[method];
    if (needed && !manifest.permissions.includes(needed)) {
      throw new Error(`"${manifest.name}" needs the "${needed}" permission`);
    }
    const text = (i: number): string => {
      if (typeof args[i] !== "string") throw new Error(`argument ${i + 1} of ${method} must be text`);
      return args[i] as string;
    };
    switch (method) {
      case "editor.getText":
        return this.#adapter.getText();
      case "editor.getSelection":
        return this.#adapter.getSelection();
      case "editor.replaceSelection":
        return this.#adapter.replaceSelection(text(0));
      case "editor.setText":
        return this.#adapter.setText(text(0));
      case "editor.setStyle":
        return this.#setStyle(manifest.id, checkPluginCss(args[0]));
      case "sync.start": {
        const port = this.#adapter.sync;
        const entry = this.#plugins.get(manifest.id);
        if (!port || !entry) throw new Error("this app cannot do live sessions");
        if (origin) throw new Error("a block can't start a live session");
        if (this.#syncOwner && this.#syncOwner !== manifest.id) throw new Error("another plugin is already in a live session");
        const token = {};
        this.#syncOwner = manifest.id;
        this.#syncToken = token;
        try {
          const text = port.start((event) => {
            if (this.#syncToken !== token) return;
            if (event.type === "ended") {
              this.#syncOwner = null;
              this.#syncToken = null;
            }
            entry.frame.contentWindow?.postMessage({ k: "sync", event }, "*");
          });
          return { text };
        } catch (e) {
          this.#syncOwner = null;
          this.#syncToken = null;
          throw e;
        }
      }
      case "sync.stop":
        if (this.#syncOwner === manifest.id) this.#endSync();
        return;
      case "sync.remote":
      case "sync.ack":
      case "sync.setCursors": {
        const port = this.#adapter.sync;
        if (!port || this.#syncOwner !== manifest.id) throw new Error("no live session");
        if (method === "sync.ack") return port.ack();
        if (method === "sync.setCursors") return port.setCursors(checkCursors(args[0]));
        if (JSON.stringify(args[0] ?? null).length > MAX_SYNC_JSON) throw new Error("that edit is too large");
        return port.remote(args[0]);
      }
      case "vault.list":
        return this.#adapter.listNotes();
      case "vault.read":
        return this.#adapter.readNote(safeNotePath(args[0]));
      case "vault.write":
        return this.#adapter.writeNote(safeNotePath(args[0]), text(1));
      case "vault.open":
        return this.#adapter.openNote(safeNotePath(args[0]), { beside: args[1] === true, origin });
      case "blocks.register": {
        const lang = text(0);
        if (!/^[a-z][a-z0-9-]{0,29}$/.test(lang)) throw new Error(`"${lang}" is not a block language (lower-case letters, digits, dashes)`);
        // Two plugins drawing the same fence: the one whose id sorts first draws it (`#claimants`), and the other is told so either way
        // (a refusal if it asks second, a notice if it asked first). Its claim is kept: it takes over if the owner is switched off.
        const entry = this.#plugins.get(manifest.id);
        if (!entry) return;
        const before = this.#blockOwner(lang);
        entry.blockLangs.add(lang);
        const owner = this.#blockOwner(lang)!;
        if (owner !== entry) throw new Error(`"${lang}" blocks are already drawn by "${owner.manifest.name}"`);
        if (before && before !== entry) {
          this.#adapter.notice(`${before.manifest.name}: "${lang}" blocks are already drawn by "${entry.manifest.name}"`);
          this.#handOver(lang);
        }
        this.#onBlocks();
        return;
      }
      case "input.register": {
        const entry = this.#plugins.get(manifest.id);
        if (!entry) return;
        if (text(0) === "paste") {
          entry.paste = true;
        } else if (text(0) === "item") {
          const id = text(1);
          if (!/^[a-z0-9-]{1,30}$/i.test(id)) throw new Error(`"${id}" is not an item id (letters, digits, dashes)`);
          entry.items.set(id, { name: text(2).slice(0, 40), description: text(3).slice(0, 120) });
        } else {
          const trigger = text(1);
          if (trigger.length < 1 || trigger.length > 8 || /\s/.test(trigger)) throw new Error(`"${trigger}" is not a trigger (1–8 characters, no spaces)`);
          // `//` belongs to the list, where every plugin gets its own entry; any other text has one owner, same rule as block languages.
          const before = this.#claimants((p) => p.triggers.has(trigger))[0];
          entry.triggers.add(trigger);
          if (trigger === "//") return;
          const owner = this.#claimants((p) => p.triggers.has(trigger))[0]!;
          if (owner !== entry) throw new Error(`typing "${trigger}" is already used by "${owner.manifest.name}"`);
          if (before && before !== entry) this.#adapter.notice(`${before.manifest.name}: typing "${trigger}" is already used by "${entry.manifest.name}"`);
        }
        return;
      }
      case "links.register": {
        const list = args[0];
        if (!Array.isArray(list) || list.length > 100) throw new Error("links.register takes 1–100 providers");
        const providers = list.map(checkLinkProvider);
        const entry = this.#plugins.get(manifest.id);
        for (const p of providers) entry?.links.set(p.id, p);
        this.#onBlocks();
        return;
      }
      case "links.chip":
        return this.linkChip(text(0));
      case "links.title": {
        const chip = this.linkChip(text(0));
        return chip ? this.runInput("link", { text: chip.key, url: text(0) }) : null;
      }
      case "links.open": {
        if (!/^https?:\/\//i.test(text(0))) throw new Error("only http and https addresses can be opened");
        return this.#adapter.openUrl?.(text(0));
      }
      case "caret.overlay": {
        if (origin) throw new Error("a block can't draw over the editor");
        const entry = this.#plugins.get(manifest.id);
        if (!entry || entry.overlay) return;
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("tabindex", "-1");
        frame.title = manifest.name;
        // Under the plugin's window (`PANEL_CSS`), over everything else; every touch and click goes through it to the editor.
        frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none;z-index:2147482000";
        if (this.#stylesPaused) frame.style.display = "none";
        frame.srcdoc = bootstrapHtml(false, false, [], false, true);
        entry.overlay = { frame, caret: null };
        document.body.append(frame);
        this.#tellBlocksCaret();
        return;
      }
      case "caret.setOptions": {
        if (origin) throw new Error("a block can't set options");
        const json = JSON.stringify(args[0] ?? null);
        if (json.length > MAX_OPTIONS) throw new Error(`options are longer than ${MAX_OPTIONS} characters`);
        const entry = this.#plugins.get(manifest.id);
        if (!entry) return;
        entry.options = JSON.parse(json) as unknown;
        try {
          localStorage.setItem(OPTIONS_KEY + manifest.id, json);
        } catch {
          // still used until the app closes
        }
        entry.overlay?.frame.contentWindow?.postMessage({ k: "caret-options", options: entry.options }, "*");
        return;
      }
      case "caret.getOptions": {
        const entry = this.#plugins.get(manifest.id);
        return entry ? this.#options(entry) : null;
      }
      case "ui.button": {
        if (origin) throw new Error("a block can't add a button");
        const title = text(0).trim();
        if (title === "" || title.length > 40) throw new Error("a button's title must be 1–40 characters");
        const entry = this.#plugins.get(manifest.id);
        // An <svg> drawn as an image needs its namespace; a plugin author should not have to know that.
        const icon = checkSvgIcon(args[1], "ui.headerButton").replace(/^<svg(?![^>]*\sxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        if (entry) entry.button = { title, icon };
        this.#onButtons();
        return;
      }
      case "ui.badge": {
        if (origin) throw new Error("a block can't change the button");
        const color = args[0];
        if (color !== null && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) throw new Error("the badge colour must look like #rrggbb, or be null");
        const entry = this.#plugins.get(manifest.id);
        if (entry) entry.badge = color === null ? null : (color as string).toLowerCase();
        this.#onButtons();
        return;
      }
      case "ui.icons": {
        if (origin) throw new Error("a block can't change the icons");
        const icons = parseIconConfig(args[0]);
        const entry = this.#plugins.get(manifest.id);
        if (entry) entry.icons = icons.rules.length > 0 || Object.keys(icons.defaults).length > 0 ? icons : undefined;
        this.#onIcons();
        return;
      }
      case "ui.copy":
        return this.#copy(text(0));
      case "notice":
        return this.#adapter.notice(text(0));
    }
  }
}

/**
 * The one object an app gives the editor to draw plugin blocks. It exists before the `PluginHost` does
 * (the host is created in an effect), so the editor can be handed it on its first render.
 */
export class BlockBridge {
  host: PluginHost | null = null;
  readonly #listeners = new Set<() => void>();
  langs = (): string[] => this.host?.blockLangs() ?? [];
  label = (lang: string): string => this.host?.blockLabel(lang) ?? lang;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  mount = (lang: string, el: HTMLElement, source: string, actions: BlockActions): BlockMount => {
    if (!this.host) throw new Error("plugins are not running");
    return this.host.mountBlock(lang, el, source, actions);
  };
  triggers = (): string[] => this.host?.inputTriggers() ?? [];
  hasPasteHook = (): boolean => this.host?.hasPasteHook() ?? false;
  menuItems = (): MenuItem[] => this.host?.menuItems() ?? [];
  linkChip = (url: string): LinkChip | null => this.host?.linkChip(url) ?? null;
  runInput = (kind: "trigger" | "paste" | "item" | "link", payload: { text: string; html?: string; url?: string }): Promise<string | null> =>
    this.host?.runInput(kind, payload) ?? Promise.resolve(null);
  wantsCaret = (): boolean => this.host?.wantsCaret() ?? false;
  caret = (event: CaretEvent): void => this.host?.caretEvent(event);
  /** Call from the host's `onBlocksChanged`. */
  changed = (): void => this.#listeners.forEach((l) => l());
}
