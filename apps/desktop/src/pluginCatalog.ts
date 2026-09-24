import { parseManifest, type PluginManifest } from "@granite/plugins";

/** A plugin the store can install: its files, bundled into the app at build time. */
export interface CatalogPlugin {
  manifest: PluginManifest;
  manifestText: string;
  code: string;
  /** URLs of the pictures shown on the plugin's page in the store. */
  screenshots: string[];
}

/** A plugin must show at least this many screenshots to be listed, so people can see what they are getting. */
export const MIN_SCREENSHOTS = 3;

// Every folder in examples/plugins is a store listing, so adding a plugin there is all it takes to list it (with 3+ pictures).
const manifests = import.meta.glob("../../../examples/plugins/*/manifest.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const codes = import.meta.glob("../../../examples/plugins/*/main.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const shots = import.meta.glob("../../../examples/plugins/*/screenshots/*.{png,jpg,jpeg,webp}", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The plugin's pictures in file-name order (01-…, 02-…). */
const screenshotsOf = (folder: string) =>
  Object.entries(shots)
    .filter(([path]) => path.startsWith(`${folder}screenshots/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);

export const CATALOG: CatalogPlugin[] = Object.entries(manifests)
  .flatMap(([path, manifestText]) => {
    const code = codes[path.replace("manifest.json", "main.js")];
    if (code === undefined) return [];
    try {
      const manifest = parseManifest(JSON.parse(manifestText));
      const screenshots = screenshotsOf(path.replace("manifest.json", ""));
      if (screenshots.length < MIN_SCREENSHOTS) {
        console.warn(`Store: "${manifest.id}" is not listed, it needs at least ${MIN_SCREENSHOTS} screenshots in screenshots/`);
        return [];
      }
      return [{ manifest, manifestText, code, screenshots }];
    } catch {
      return []; // a broken example is left out of the store rather than breaking it
    }
  })
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
