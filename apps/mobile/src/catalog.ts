import type { ImageSourcePropType } from 'react-native';
import { parseManifest, type PluginManifest } from '@granite/plugins';
import { CATALOG_FILES } from './pluginCatalog';

/** A plugin the phone's Store can install: its files, bundled into the app (see scripts/build-catalog.mjs). */
export interface CatalogPlugin {
  manifest: PluginManifest;
  manifestText: string;
  code: string;
  /** Pictures for the plugin's page in the Store. */
  screenshots: ImageSourcePropType[];
}

/** A plugin must show at least this many screenshots to be listed (the same rule as the desktop Store). */
export const MIN_SCREENSHOTS = 3;

export const CATALOG: CatalogPlugin[] = CATALOG_FILES.flatMap((f) => {
  try {
    const manifest = parseManifest(JSON.parse(f.manifestText));
    return manifest.desktopOnly || f.screenshots.length < MIN_SCREENSHOTS ? [] : [{ manifest, ...f }];
  } catch {
    return []; // a broken example is left out rather than breaking the Store
  }
}).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
