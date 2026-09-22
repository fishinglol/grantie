import { parseManifest, type PluginManifest } from "@granite/plugins";

/** A plugin the store can install: its files, bundled into the app at build time. */
export interface CatalogPlugin {
  manifest: PluginManifest;
  manifestText: string;
  code: string;
}

// Every folder in examples/plugins is a store listing, so adding a plugin there is all it takes to list it.
const manifests = import.meta.glob("../../../examples/plugins/*/manifest.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const codes = import.meta.glob("../../../examples/plugins/*/main.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const CATALOG: CatalogPlugin[] = Object.entries(manifests)
  .flatMap(([path, manifestText]) => {
    const code = codes[path.replace("manifest.json", "main.js")];
    if (code === undefined) return [];
    try {
      return [{ manifest: parseManifest(JSON.parse(manifestText)), manifestText, code }];
    } catch {
      return []; // a broken example is left out of the store rather than breaking it
    }
  })
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
