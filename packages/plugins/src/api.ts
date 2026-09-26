import type { Permission } from "./manifest.ts";

/**
 * The `granite` global that a plugin sees. Everything is async because the plugin runs in a sandbox
 * and reaches the app over messages, the same on desktop and phone. Each group needs the permission
 * named in its comment; a call without it rejects.
 *
 * Plugin authors: `declare const granite: import("@granite/plugins").GraniteApi;`
 */
/** What a block gets to talk back to the note with. */
export interface BlockContext {
  /** Replace the text between the block's ``` fences (typing in the block saves through this). */
  save(source: string): void;
  /** Tell the note how tall the block is, in pixels, or `"fill"` to take the whole height of the page. */
  resize(height: number | "fill"): void;
  /** Delete the whole block, fences included. */
  remove(): void;
  /** Turn the block back into plain text with the cursor in it (to fix or read the raw text). */
  edit(): void;
}

/** What a block's render function may return. */
export interface BlockHandle {
  /** The text between the fences changed from outside (undo, sync); redraw. Not called for the block's own `save`. */
  update?(source: string): void;
}

/** What was on the clipboard when the user pasted. */
export interface PasteClip {
  /** `text/plain`, e.g. the tab-separated rows of copied spreadsheet cells. */
  text: string;
  /** `text/html` ("" when there is none). */
  html: string;
}

export interface LinkProviderInfo {
  id: string;
  name: string;
  label?: string;
  hosts: string[];
  color: string;
  icon: string;
  title?: (url: string) => string | null | Promise<string | null>;
}

/** One edit or caret report the open note sends a live session. `changes` is CodeMirror's `ChangeSet.toJSON()`; `base` is how many log entries the note has taken in (see `editor.sync`). */
export type SyncEvent =
  | { type: "change"; base: number; changes: unknown }
  | { type: "selection"; base: number; anchor: number; head: number }
  | { type: "ended"; reason?: string };

/** Somebody else's caret / selection, as positions in the shared text. `color` is `#rrggbb`. */
export interface SyncCursor {
  id: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
}

/** What the plugin's window gets to talk back to the app with (`ui.headerButton`). */
export interface PanelContext {
  /** Close the window. The Escape key and a tap outside it close it too. */
  close(): void;
  /** How tall the window is, in pixels (kept between 120 and the screen height). */
  resize(height: number): void;
}

/** A plugin's button at the top of the open note, as the apps list it. `icon` is a `data:image/svg+xml` URI (draw it as a mask so it takes the button's colour). */
export interface HeaderButton {
  pluginId: string;
  title: string;
  icon: string;
  /** `#rrggbb` of a small dot on the button, or null. */
  badge: string | null;
}

export interface GraniteApi {
  commands: {
    /**
     * Add a command the user can run from the Plugins screen. No permission needed. With `page: true` it is also
     * listed in the ⋯ menu at the top right of the open note ("Turn this page into a sheet").
     */
    add(command: { id: string; name: string; page?: boolean; run: () => void | Promise<void> }): void;
  };
  editor: {
    /** editor.read: the whole open note. */
    getText(): Promise<string>;
    /** editor.read: the selected text ("" when nothing is selected). */
    getSelection(): Promise<string>;
    /** editor.write: replace the selection, or insert at the cursor when nothing is selected. */
    replaceSelection(text: string): Promise<void>;
    /** editor.write: replace the whole open note (the user can undo it). */
    setText(text: string): Promise<void>;
    /**
     * editor.style: apply CSS to the app while the plugin runs ("" removes it; it is removed automatically when
     * the plugin is switched off). The editor's colours are CSS variables (`--text`, `--h`, `--accent`, `--bg`,
     * `--panel`, …) on `.live-editor`, so restyling usually means setting those. No `@import` or `url()`.
     */
    setStyle(css: string): Promise<void>;
    /**
     * editor.sync (API 6): a live session of the open note with other people (Google-Docs style). The plugin is the *authority*: it keeps the
     * shared text, puts every edit into one ordered log, and the note follows that log. Edits travel as CodeMirror `ChangeSet` JSON
     * (`ChangeSet.toJSON()`), so bundle `@codemirror/state` to read and map them. One session at a time; it ends by itself when another note opens.
     *
     * The note has taken in `base` entries of the log: your own `remote` edits and the `ack`s of its edits. Protocol:
     * - `start(onEvent)` gives the note's text (log entry 0). `onEvent` then gets `{ type: "change", base, changes }` for what the user typed, at most
     *   one at a time until you `ack()` it; later typing is composed into the next one. Map `changes` over your log entries from `base` on, apply it
     *   to the shared text, add it to the log, and `ack()`. `{ type: "selection", base, anchor, head }` is the caret, sent only when nothing is waiting.
     * - Something from other people: add it to the log and call `remote(changes)` (based on the text after every entry you sent so far).
     *   Every log entry goes to the note exactly once, in order: an `ack()` for the user's own, `remote()` for the rest.
     * - `setCursors` draws other people's carets and selections (positions in the text after every entry you sent so far).
     */
    sync: {
      start(onEvent: (event: SyncEvent) => void): Promise<{ text: string }>;
      stop(): Promise<void>;
      remote(changes: unknown): Promise<void>;
      ack(): Promise<void>;
      /** At most 50 carets; `name` up to 40 characters. Pass `[]` to remove them all. */
      setCursors(cursors: SyncCursor[]): Promise<void>;
    };
  };
  ui: {
    /**
     * ui.panel (API 7): put a button (one per plugin) next to the reading-mode / split / ⋯ buttons at the top of a note. Pressing it shows
     * the plugin's own frame as a window (a sheet from the bottom on a phone) and calls `open(el, panel)` with `el` = the frame's `<body>`
     * (fill it; the frame gets the editor's colour variables like a block). `open` runs every time the window is opened; the
     * body keeps what it had. The plugin's code keeps running while the window is closed, so it can hold state. `open` may return `{ close() }`
     * to be told when the window closes. `icon` is a plain `<svg>` (stroke only; it is drawn in the button's colour), `title` up to 40 characters.
     */
    headerButton(button: {
      title: string;
      icon: string;
      open: (el: HTMLElement, panel: PanelContext) => void | { close?(): void };
    }): Promise<void>;
    /** ui.panel: a small dot (`#rrggbb`) on the button, or `null` to remove it (e.g. "you are live"). */
    setBadge(color: string | null): Promise<void>;
    /** ui.panel: put text on the clipboard (at most 10 000 characters). Rejects when the system refuses. */
    copy(text: string): Promise<void>;
  };
  blocks: {
    /**
     * editor.blocks: draw every fenced block of this language (```sheet … ```) inside the note, in place, as the
     * plugin's own page. `render` runs once per block in its own sandboxed frame: fill `el` (the frame's `<body>`);
     * `source` is the text between the fences. The block shows as plain text while the cursor is inside it.
     */
    register(lang: string, render: (el: HTMLElement, source: string, block: BlockContext) => BlockHandle | void): void;
  };
  input: {
    /**
     * editor.input (API 2): when the user types `text` (1–8 characters, e.g. `//`) alone on an empty line, that text is removed and
     * whatever `handler` returns is put there instead (return `null` to put the typed text back). Not inside code blocks.
     */
    trigger(text: string, handler: () => string | null | Promise<string | null>): Promise<void>;
    /**
     * editor.input (API 2): the user pasted something that has tabs in it (rows copied from Excel or Sheets). Return the text to
     * insert instead, or `null` to let the paste through untouched. One handler per plugin; it has 5 seconds.
     */
    onPaste(handler: (clip: PasteClip) => string | null | Promise<string | null>): Promise<void>;
    /**
     * editor.input (API 4): put an entry in the list that appears when the user types `//` alone on an empty line, next to the
     * other plugins' entries. Choosing it removes the typed `//` and puts whatever `insert` returns (Markdown) there.
     * `name` is what the list shows (and what typing after `//` filters on), `description` is one line under it.
     */
    addItem(item: { id: string; name: string; description?: string; insert: () => string | Promise<string> }): Promise<void>;
  };
  links: {
    /**
     * editor.links (API 5): tell the editor about sites so a Markdown link `[Title](url)` to one of them is drawn as a chip (the site's icon
     * and the title), and a pasted address of one offers "Tab to replace with" that chip. `hosts` are `youtube.com` (and subdomains) or
     * `docs.google.com/document` (that path only); the most specific one wins. `icon` is a small `<svg>` with no scripts or links.
     * `title(url)` is asked when an address is pasted: return the page's title, or null to use `label`. It has 5 seconds, and can use
     * `fetch` if the manifest has `network`. Pass one provider or a list.
     */
    register(provider: LinkProviderInfo | LinkProviderInfo[]): Promise<void>;
    /** editor.links: how a link to `url` is drawn (icon, colour, name), if a running plugin (Smart Chips) knows that site, else null. For a block that draws chips itself, e.g. in table cells. `icon` is an image URL. */
    chip(url: string): Promise<{ name: string; label: string; color: string; icon: string } | null>;
    /** editor.links: the page's title from the plugin that knows the site (it may fetch it; up to 5 seconds), or null. */
    title(url: string): Promise<string | null>;
    /** editor.links: open a web address (http / https) in the system browser. */
    open(url: string): Promise<void>;
  };
  vault: {
    /** vault.read: vault-relative paths of every note, e.g. `Projects/plan.md`. */
    list(): Promise<string[]>;
    /** vault.read */
    read(path: string): Promise<string>;
    /** vault.write: only `.md` notes inside the vault; never the hidden `.granite` folder. */
    write(path: string, text: string): Promise<void>;
    /**
     * vault.read (API 3): open a note in the editor, in place of the one showing now. With `{ beside: true }` (API 4) a desktop
     * window opens it in the other half of a split view (making one if needed) so the page you called from stays visible; the
     * phone opens it full screen with a button back to the page you came from.
     */
    open(path: string, options?: { beside?: boolean }): Promise<void>;
  };
  /** Show a short message. No permission needed. */
  notice(message: string): void;
}

/** RPC methods a plugin can call, and the permission each needs (null = always allowed). */
export const METHOD_PERMISSION: Record<string, Permission | null> = {
  "editor.getText": "editor.read",
  "editor.getSelection": "editor.read",
  "editor.replaceSelection": "editor.write",
  "editor.setText": "editor.write",
  "editor.setStyle": "editor.style",
  "sync.start": "editor.sync",
  "sync.stop": "editor.sync",
  "sync.remote": "editor.sync",
  "sync.ack": "editor.sync",
  "sync.setCursors": "editor.sync",
  "ui.button": "ui.panel",
  "ui.badge": "ui.panel",
  "ui.copy": "ui.panel",
  "blocks.register": "editor.blocks",
  "input.register": "editor.input",
  "links.register": "editor.links",
  "links.chip": "editor.links",
  "links.title": "editor.links",
  "links.open": "editor.links",
  "vault.list": "vault.read",
  "vault.read": "vault.read",
  "vault.write": "vault.write",
  "vault.open": "vault.read",
  notice: null,
};

export interface CommandInfo {
  pluginId: string;
  id: string;
  name: string;
  /** Also offered in the note's ⋯ menu. */
  page?: boolean;
}

/** A vault-relative path to a file of the person's: inside the vault and not in a hidden folder (so never `.granite`, where plugins live). */
export function safeVaultPath(path: unknown): string {
  if (typeof path !== "string" || path === "") throw new Error("path must be a non-empty string");
  if (path.startsWith("/") || path.includes("\\") || /^[a-z]+:/i.test(path)) throw new Error(`"${path}" is not a vault-relative path`);
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) {
    throw new Error(`"${path}" is outside the vault's notes`);
  }
  return path;
}

/** A vault path a plugin may read or write: relative, inside the vault, not hidden, a Markdown note. */
export function safeNotePath(path: unknown): string {
  const checked = safeVaultPath(path);
  if (!/\.(md|markdown)$/i.test(checked)) throw new Error(`"${checked}" is not a Markdown note`);
  return checked;
}

/** Largest stylesheet a plugin may apply. */
export const MAX_PLUGIN_CSS = 20_000;

/**
 * The CSS with its comments removed the way a browser reads it: `/*` inside a quoted string is text, not a comment. (Removing
 * comments with a regex let `"/*"` ... `"*\/"` hide a `url(` from the check below.) Strings are kept, so a forbidden word inside
 * one is still refused. Backslashes are refused before this runs, so a string always ends at its quote or a line break.
 */
function withoutComments(css: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === quote || ch === "\n" || ch === "\r" || ch === "\f") quote = "";
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new Error("style has a comment that is never closed");
      i = end + 1;
      out += " ";
      continue;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
    out += ch;
  }
  return out;
}

/**
 * Plugin CSS must not load anything (`@import`, `url()`, `image-set()`, ...) and can't break out of its `<style>`:
 * a stylesheet that can fetch a URL could be used to phone home. Throws with a readable message.
 */
export function checkPluginCss(css: unknown): string {
  if (typeof css !== "string") throw new Error("style must be text");
  if (css.length > MAX_PLUGIN_CSS) throw new Error(`style is longer than ${MAX_PLUGIN_CSS} characters`);
  if (css.includes("\\")) throw new Error("style may not use backslash escapes");
  if (/@import|\b(url|src|image|image-set|cross-fade|element|expression)\s*\(|<\/?style|<!--|behavior\s*:/i.test(withoutComments(css))) {
    throw new Error("style may not use @import, url(), image-set() or other ways of loading something");
  }
  return css;
}
