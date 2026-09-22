import { parseManifest, type PluginManifest } from '@granite/plugins';
import { CATALOG_FILES } from './pluginCatalog';

/** A plugin the phone's Store can install: its files, bundled into the app (see scripts/build-catalog.mjs). */
export interface CatalogPlugin {
  manifest: PluginManifest;
  manifestText: string;
  code: string;
}

export const CATALOG: CatalogPlugin[] = CATALOG_FILES.flatMap((f) => {
  try {
    const manifest = parseManifest(JSON.parse(f.manifestText));
    return manifest.desktopOnly ? [] : [{ manifest, ...f }];
  } catch {
    return []; // a broken example is left out rather than breaking the Store
  }
}).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
