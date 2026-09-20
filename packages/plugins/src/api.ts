import type { Permission } from "./manifest.ts";

/**
 * The `granite` global that a plugin sees. Everything is async because the plugin runs in a sandbox
 * and reaches the app over messages, the same on desktop and phone. Each group needs the permission
 * named in its comment; a call without it rejects.
 *
 * Plugin authors: `declare const granite: import("@granite/plugins").GraniteApi;`
 */
export interface GraniteApi {
  commands: {
    /** Add a command the user can run from the Plugins screen. No permission needed. */
    add(command: { id: string; name: string; run: () => void | Promise<void> }): void;
  };
  editor: {
    /** editor.read: the whole open note. */
    getText(): Promise<string>;
    /** editor.read: the selected text ("" when nothing is selected). */
    getSelection(): Promise<string>;
    /** editor.write: replace the selection, or insert at the cursor when nothing is selected. */
    replaceSelection(text: string): Promise<void>;
    /**
     * editor.style: apply CSS to the app while the plugin runs ("" removes it; it is removed automatically when
     * the plugin is switched off). The editor's colours are CSS variables (`--text`, `--h`, `--accent`, `--bg`,
     * `--panel`, …) on `.live-editor`, so restyling usually means setting those. No `@import` or `url()`.
     */
    setStyle(css: string): Promise<void>;
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
  "editor.setStyle": "editor.style",
  "vault.list": "vault.read",
  "vault.read": "vault.read",
  "vault.write": "vault.write",
  notice: null,
};

export interface CommandInfo {
  pluginId: string;
  id: string;
  name: string;
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
