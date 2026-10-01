import type { ImageSourcePropType } from 'react-native';
import { fetchRegistry, parseManifest, type PluginManifest } from '@granite/plugins';
import { CATALOG_FILES } from './pluginCatalog';

/** A plugin the phone's Store can install: bundled into the app (see scripts/build-catalog.mjs), or listed in the registry and fetched from its author's repo. */
export interface CatalogPlugin {
  manifest: PluginManifest;
  manifestText: string;
  /** The plugin's `main.js`. For a registry plugin this fetches it and refuses it if it isn't the reviewed version. */
  getCode: () => Promise<string>;
  /** `owner/name` of the author's GitHub repo, for plugins that live there. */
  repo?: string;
  /** Pictures for the plugin's page in the Store. */
  screenshots: ImageSourcePropType[];
}

/** A plugin must show at least this many screenshots to be listed (the same rule as the desktop Store). */
export const MIN_SCREENSHOTS = 3;

export const CATALOG: CatalogPlugin[] = CATALOG_FILES.flatMap((f) => {
  try {
    const manifest = parseManifest(JSON.parse(f.manifestText));
    return manifest.desktopOnly || f.screenshots.length < MIN_SCREENSHOTS ? [] : [{ manifest, manifestText: f.manifestText, getCode: async () => f.code, screenshots: f.screenshots }];
  } catch {
    return []; // a broken example is left out rather than breaking the Store
  }
}).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

/** The bundled plugins plus the registry's (plugins in their authors' own repos). Offline or with the registry down, just the bundled ones. */
export async function loadCatalog(): Promise<CatalogPlugin[]> {
  try {
    const bundled = new Set(CATALOG.map((c) => c.manifest.id));
    const remote = (await fetchRegistry()).flatMap((r): CatalogPlugin[] =>
      bundled.has(r.manifest.id) || r.manifest.desktopOnly || r.screenshots.length < MIN_SCREENSHOTS
        ? []
        : [{ manifest: r.manifest, manifestText: r.manifestText, getCode: r.getCode, repo: r.entry.repo, screenshots: r.screenshots.map((uri) => ({ uri })) }],
    );
    return [...CATALOG, ...remote].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  } catch {
    return CATALOG;
  }
}
