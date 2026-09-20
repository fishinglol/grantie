import { join } from "@granite/core-notes";
import type { VaultFileSystem } from "@granite/core-cloud";
import { parseManifest, type PluginManifest } from "./manifest.ts";

/** Where plugins live, relative to the vault. Synced with the vault, so a plugin reaches every device. */
export const PLUGINS_DIR = ".granite/plugins";

export interface InstalledPlugin {
  /** The folder name; equals `manifest.id` when the plugin is valid. */
  folder: string;
  manifest?: PluginManifest;
  /** Why the plugin can't be used (bad manifest, missing main.js, id mismatch). */
  error?: string;
}

/** Every plugin folder in `<vault>/.granite/plugins`, valid or not, so problems can be shown. */
export async function discoverPlugins(fs: VaultFileSystem, vaultDir: string): Promise<InstalledPlugin[]> {
  const root = join(vaultDir, PLUGINS_DIR);
  if (!(await fs.exists(root))) return [];
  const found: InstalledPlugin[] = [];
  for (const entry of await fs.listDir(root)) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    try {
      const manifest = parseManifest(JSON.parse(await fs.readTextFile(join(dir, "manifest.json"))));
      if (manifest.id !== entry.name) throw new Error(`the folder is "${entry.name}" but manifest.json says id "${manifest.id}"`);
      if (!(await fs.exists(join(dir, "main.js")))) throw new Error("main.js is missing");
      found.push({ folder: entry.name, manifest });
    } catch (e) {
      found.push({ folder: entry.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return found.sort((a, b) => a.folder.localeCompare(b.folder));
}

/** The plugin's compiled code. */
export function readPluginCode(fs: VaultFileSystem, vaultDir: string, id: string): Promise<string> {
  return fs.readTextFile(join(vaultDir, PLUGINS_DIR, id, "main.js"));
}
