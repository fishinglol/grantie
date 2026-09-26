/**
 * What a plugin may ask for. Nothing is granted implicitly: the user enables a plugin on each
 * device after seeing this list, and the host refuses any call outside it.
 */
export const PERMISSIONS = ["editor.read", "editor.write", "editor.style", "editor.blocks", "editor.input", "editor.links", "editor.sync", "ui.panel", "vault.read", "vault.write", "network"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "editor.read": "Read the open note",
  "editor.write": "Change the open note",
  "editor.style": "Change how the editor looks",
  "editor.blocks": "Draw its own blocks inside your notes",
  "editor.input": "See what you type on an empty line and what you paste",
  "editor.links": "Show links to known sites as chips",
  "editor.sync": "Follow what you type and your cursor as you type, and change the note live (for working together)",
  "ui.panel": "Add a button at the top of a note and open a window of its own",
  "vault.read": "Read your notes",
  "vault.write": "Create and change notes",
  network: "Use the internet",
};

/** Version of the plugin API this app implements. A plugin can require a minimum. */
export const API_VERSION = 7;

export interface PluginManifest {
  /** Lower-case letters, digits and dashes; also the plugin's folder name. */
  id: string;
  name: string;
  version: string;
  description?: string;
  /** One short line for the store's list (the description is for the detail page). */
  tagline?: string;
  author?: string;
  permissions: Permission[];
  /** Lowest API version the plugin needs. */
  minApiVersion?: number;
  /** Uses nothing the phone can offer (e.g. a large screen); hidden there. */
  desktopOnly?: boolean;
  /**
   * Servers the plugin may open a connection to, as `wss://host[:port]` or `ws://host[:port]` (the latter for a server on your own
   * network). `network` already allows any `https` / `wss` address; this is how a plugin gets a plain `ws` one, and it is shown to the user.
   */
  connect?: string[];
  /**
   * What to do before the plugin works, one step per line (the Store shows them as "Before you start", numbered). Plain text, at most
   * 8 steps of 300 characters. For anything the person must set up first (an account, a server); leave it out when there is nothing.
   */
  setup?: string[];
  /** Listed in the Store as "SOON": it can be looked at but not installed. */
  soon?: boolean;
}

const CONNECT = /^wss?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/** What the user is asked to allow, one line each: the permissions, then the servers. */
export function permissionLines(manifest: PluginManifest): string[] {
  return [...manifest.permissions.map((p) => PERMISSION_LABELS[p]), ...(manifest.connect ?? []).map((h) => `Connect to ${h}`)];
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Validate a parsed `manifest.json`. Throws an `Error` whose message is fit to show the user. */
export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("manifest.json must be an object");
  const m = raw as Record<string, unknown>;
  const text = (key: string, required: boolean): string | undefined => {
    const v = m[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || v.trim() === "") throw new Error(`manifest.json: "${key}" must be a non-empty string`);
    return v;
  };
  const id = text("id", true)!;
  if (!ID.test(id)) throw new Error(`manifest.json: "id" must be lower-case letters, digits and dashes (got "${id}")`);
  const permissions = m.permissions ?? [];
  if (!Array.isArray(permissions)) throw new Error('manifest.json: "permissions" must be a list');
  for (const p of permissions) {
    if (!(PERMISSIONS as readonly unknown[]).includes(p)) throw new Error(`manifest.json: unknown permission "${String(p)}"`);
  }
  const minApiVersion = m.minApiVersion;
  if (minApiVersion !== undefined && (typeof minApiVersion !== "number" || !Number.isInteger(minApiVersion))) {
    throw new Error('manifest.json: "minApiVersion" must be a whole number');
  }
  const connect = m.connect ?? [];
  if (!Array.isArray(connect) || connect.length > 10) throw new Error('manifest.json: "connect" must be a list of up to 10 servers');
  for (const c of connect) {
    if (typeof c !== "string" || !CONNECT.test(c)) throw new Error(`manifest.json: "connect" entries look like wss://host or ws://host:1234 (got "${String(c)}")`);
  }
  const setup = m.setup ?? [];
  if (!Array.isArray(setup) || setup.length > 8) throw new Error('manifest.json: "setup" must be a list of up to 8 steps');
  for (const step of setup) {
    if (typeof step !== "string" || step.trim() === "" || step.length > 300) throw new Error('manifest.json: each "setup" step must be text of 1–300 characters');
  }
  return {
    id,
    name: text("name", true)!,
    version: text("version", true)!,
    description: text("description", false),
    tagline: text("tagline", false),
    author: text("author", false),
    permissions: [...new Set(permissions as Permission[])],
    minApiVersion: minApiVersion as number | undefined,
    desktopOnly: m.desktopOnly === true,
    ...(connect.length > 0 && { connect: [...new Set(connect as string[])] }),
    ...(setup.length > 0 && { setup: setup as string[] }),
    ...(m.soon === true && { soon: true }),
  };
}

/**
 * The hue (0–360) of a plugin's store icon, stable per id and kept near Granite's orange accent, so tiles differ from
 * one another but stay in the app's palette. Both apps use it.
 */
export function pluginHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 60;
  return (22 + h - 30 + 360) % 360;
}
