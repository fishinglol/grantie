/**
 * What a plugin may ask for. Nothing is granted implicitly: the user enables a plugin on each
 * device after seeing this list, and the host refuses any call outside it.
 */
export const PERMISSIONS = ["editor.read", "editor.write", "vault.read", "vault.write", "network"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "editor.read": "Read the open note",
  "editor.write": "Change the open note",
  "vault.read": "Read your notes",
  "vault.write": "Create and change notes",
  network: "Use the internet",
};

/** Version of the plugin API this app implements. A plugin can require a minimum. */
export const API_VERSION = 1;

export interface PluginManifest {
  /** Lower-case letters, digits and dashes; also the plugin's folder name. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions: Permission[];
  /** Lowest API version the plugin needs. */
  minApiVersion?: number;
  /** Uses nothing the phone can offer (e.g. a large screen); hidden there. */
  desktopOnly?: boolean;
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
  return {
    id,
    name: text("name", true)!,
    version: text("version", true)!,
    description: text("description", false),
    author: text("author", false),
    permissions: [...new Set(permissions as Permission[])],
    minApiVersion: minApiVersion as number | undefined,
    desktopOnly: m.desktopOnly === true,
  };
}
