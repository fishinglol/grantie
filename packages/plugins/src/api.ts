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
