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
  };
  vault: {
    /** vault.read: vault-relative paths of every note, e.g. `Projects/plan.md`. */
    list(): Promise<string[]>;
    /** vault.read */
    read(path: string): Promise<string>;
    /** vault.write: only `.md` notes inside the vault; never the hidden `.granite` folder. */
    write(path: string, text: string): Promise<void>;
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
  "blocks.register": "editor.blocks",
  "input.register": "editor.input",
  "vault.list": "vault.read",
  "vault.read": "vault.read",
  "vault.write": "vault.write",
  notice: null,
};

export interface CommandInfo {
  pluginId: string;
  id: string;
  name: string;
  /** Also offered in the note's ⋯ menu. */
  page?: boolean;
}

/** A vault path a plugin may read or write: relative, inside the vault, not hidden, a Markdown note. */
export function safeNotePath(path: unknown): string {
  if (typeof path !== "string" || path === "") throw new Error("path must be a non-empty string");
  if (path.startsWith("/") || path.includes("\\") || /^[a-z]+:/i.test(path)) throw new Error(`"${path}" is not a vault-relative path`);
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) {
    throw new Error(`"${path}" is outside the vault's notes`);
  }
  if (!/\.(md|markdown)$/i.test(path)) throw new Error(`"${path}" is not a Markdown note`);
  return path;
}

/** Largest stylesheet a plugin may apply. */
export const MAX_PLUGIN_CSS = 20_000;

/**
 * Plugin CSS must not load anything (`@import`, `url()`, `image-set`) and can't break out of its `<style>`:
 * a stylesheet that can fetch a URL could be used to phone home. Throws with a readable message.
 */
export function checkPluginCss(css: unknown): string {
  if (typeof css !== "string") throw new Error("style must be text");
  if (css.length > MAX_PLUGIN_CSS) throw new Error(`style is longer than ${MAX_PLUGIN_CSS} characters`);
  // Strip comments first so `/* */` can't hide or split a forbidden token.
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import|url\s*\(|image-set\s*\(|expression\s*\(|<\/?style|<!--|behavior\s*:|\\/i.test(plain)) {
    throw new Error("style may not use @import, url(), image-set() or backslash escapes");
  }
  return css;
}
